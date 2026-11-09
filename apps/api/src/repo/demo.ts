import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DriftKind, Finding, MandateFields } from '@intentlock/shared';
import { FIXTURE_OFFERS } from '../adapters/catalog/fixtureCatalogProvider';
import { normalizeOffer } from '../core/normalizeOffer';
import { mandateHash } from '../core/mandateHash';
import { evaluate } from '../core/policy';
import { notFound, stateConflict } from '../errors';
import type { Db } from './db';
import { appendAudit, lockSession } from './audit';
import { getPurchase, toPurchaseDto, transitionPurchase } from './purchases';
import { auditEvents, evaluations, mandates, offerSnapshots, purchases } from './schema';

const CountsSchema = z.strictObject({
  mandates: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
  purchases: z.number().int().nonnegative(),
});

export class DemoRepository {
  constructor(
    private readonly db: Db,
    private readonly policyVersion: string,
  ) {}

  async drift(sessionId: string, id: string, kind: DriftKind) {
    return this.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const current = await getPurchase(tx, sessionId, id);
      if (!current) throw notFound();
      if (current.state !== 'ORDER_CREATED' || current.seeded)
        throw stateConflict('Drift simulation requires a non-sample purchase in ORDER_CREATED.');
      const row = await transitionPurchase(tx, current, 'ORDER_CREATED', { simulatedDrift: kind });
      if (!row) throw stateConflict('Purchase changed while simulating drift.');
      await appendAudit(tx, {
        sessionId,
        purchaseId: id,
        mandateId: row.mandateId,
        type: 'DRIFT_SIMULATED',
        payload: { kind },
      });
      return toPurchaseDto(row);
    });
  }

  async seed(sessionId: string) {
    return this.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const [existing] = await tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.sessionId, sessionId), eq(auditEvents.type, 'DEMO_SEEDED')))
        .limit(1);
      if (existing)
        return { created: false, seeded: CountsSchema.parse(existing.payload['counts']) };
      const mandateId = randomUUID();
      const fields: MandateFields = {
        productQuery: 'office procurement samples',
        quantity: 1,
        maxTotal: '120.00',
        currency: 'USD',
        allowedMerchantDomains: ['northstar-office.example'],
        recurringAllowed: false,
        excludedTerms: [],
      };
      const at = new Date(Date.now() - 3 * 86_400_000);
      await tx.insert(mandates).values({
        id: mandateId,
        sessionId,
        status: 'CONFIRMED',
        requestText: 'Sample office procurement history',
        productQuery: fields.productQuery,
        quantity: 1,
        maxTotalMinor: 12000n,
        currency: 'USD',
        allowedMerchantDomains: fields.allowedMerchantDomains,
        parser: 'rule:v1',
        confirmedAt: at,
        createdAt: at,
        seeded: true,
      });
      for (const type of ['MANDATE_DRAFTED', 'MANDATE_CONFIRMED'] as const) {
        await appendAudit(tx, {
          sessionId,
          mandateId,
          type,
          payload: { seeded: true, fields, version: 1, parser: 'rule:v1' },
        });
      }
      const selections = [
        { fixture: 0, outcome: 'CAPTURED' },
        { fixture: 0, outcome: 'BLOCKED_AT_CAPTURE' },
        { fixture: 2, outcome: null },
        { fixture: 3, outcome: null },
      ] as const;
      for (const [index, sample] of selections.entries()) {
        const raw = FIXTURE_OFFERS[sample.fixture];
        if (!raw) throw new Error('Sample fixture missing');
        const offer = normalizeOffer(raw);
        const snapshotId = randomUUID();
        const observedAt = new Date(at.getTime() + index * 3_600_000);
        const amount = offer.unitAmountMinor === null ? null : BigInt(offer.unitAmountMinor);
        await tx.insert(offerSnapshots).values({
          ...offer,
          id: snapshotId,
          mandateId,
          source: 'fixture',
          observedAt,
          unitAmountMinor: amount,
        });
        const result = evaluate(fields, offer, this.policyVersion, observedAt);
        await tx.insert(evaluations).values({
          id: randomUUID(),
          offerSnapshotId: snapshotId,
          ...result,
          evaluatedAt: observedAt,
        });
        await appendAudit(tx, {
          sessionId,
          mandateId,
          type: 'OFFER_EVALUATED',
          payload: {
            seeded: true,
            snapshotId,
            decision: result.decision,
            findings: result.findings,
            policyVersion: this.policyVersion,
            source: 'fixture',
          },
        });
        if (!sample.outcome) continue;
        if (amount === null || !offer.merchantDomain || result.decision !== 'ALLOWED')
          throw new Error('Sample purchase must be policy-allowed');
        const id = randomUUID();
        const hash = mandateHash({
          mandateId,
          mandateVersion: 1,
          offerId: snapshotId,
          merchantDomain: offer.merchantDomain,
          quantity: 1,
          unitPriceMinor: amount.toString(),
          totalMinor: amount.toString(),
          currency: 'USD',
          recurring: false,
        });
        const expiresAt = new Date(observedAt.getTime() + 900_000);
        const blocked: Finding[] = [
          {
            code: 'DRIFT_AMOUNT_MISMATCH',
            severity: 'BLOCKING',
            message: 'Simulated price hike blocked capture.',
            evidence: {},
          },
        ];
        await tx.insert(purchases).values({
          id,
          sessionId,
          mandateId,
          offerSnapshotId: snapshotId,
          mandateHash: hash,
          itemName: offer.title,
          quantity: 1,
          unitAmountMinor: amount,
          totalMinor: amount,
          state: sample.outcome,
          seeded: true,
          approvedAt: observedAt,
          approvalExpiresAt: expiresAt,
          blockReasons: sample.outcome === 'BLOCKED_AT_CAPTURE' ? blocked : null,
          simulatedDrift: sample.outcome === 'BLOCKED_AT_CAPTURE' ? 'PRICE_HIKE' : null,
          createdAt: observedAt,
          updatedAt: observedAt,
        });
        await appendAudit(tx, {
          sessionId,
          mandateId,
          purchaseId: id,
          type: 'PURCHASE_CREATED',
          payload: {
            seeded: true,
            totalMinor: amount.toString(),
            mandateHash: hash,
            merchantDomain: offer.merchantDomain,
          },
        });
        await appendAudit(tx, {
          sessionId,
          mandateId,
          purchaseId: id,
          type: 'PURCHASE_APPROVED',
          payload: {
            seeded: true,
            mandateHash: hash,
            approvedAt: observedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
        });
        if (sample.outcome === 'BLOCKED_AT_CAPTURE') {
          await appendAudit(tx, {
            sessionId,
            mandateId,
            purchaseId: id,
            type: 'DRIFT_SIMULATED',
            payload: { seeded: true, kind: 'PRICE_HIKE' },
          });
        }
        await appendAudit(tx, {
          sessionId,
          mandateId,
          purchaseId: id,
          type: sample.outcome === 'CAPTURED' ? 'PAYPAL_CAPTURED' : 'CAPTURE_BLOCKED',
          payload:
            sample.outcome === 'CAPTURED'
              ? { seeded: true, status: 'COMPLETED', sample: true }
              : {
                  seeded: true,
                  simulated: true,
                  findings: blocked,
                  reasonCodes: ['DRIFT_AMOUNT_MISMATCH'],
                },
        });
      }
      const seeded = { mandates: 1, evaluations: 4, purchases: 2 };
      await appendAudit(tx, {
        sessionId,
        mandateId,
        type: 'DEMO_SEEDED',
        payload: { seeded: true, counts: seeded },
      });
      return { created: true, seeded };
    });
  }
}
