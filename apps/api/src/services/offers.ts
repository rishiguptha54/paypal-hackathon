import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { EvaluatedOffer, MandateFields } from '@intentlock/shared';
import type { CatalogService } from '../adapters/catalog/catalogService';
import type { NormalizedOffer } from '../core/normalizeOffer';
import { evaluate } from '../core/policy';
import { formatUsd, toMoney } from '../core/money';
import { notFound, stateConflict } from '../errors';
import type { Db } from '../repo/db';
import { evaluations, mandates, offerSnapshots } from '../repo/schema';
import { appendAudit, lockSession } from '../repo/audit';

export class OfferService {
  constructor(
    private readonly d: {
      db: Db;
      catalog: CatalogService;
      policyVersion: string;
      now?: () => Date;
    },
  ) {}

  async search(sessionId: string, mandateId: string) {
    const [mandate] = await this.d.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, mandateId), eq(mandates.sessionId, sessionId)));
    if (!mandate) throw notFound();
    if (mandate.status !== 'CONFIRMED')
      throw stateConflict('Mandate must be confirmed before search.');

    const fields = mandateFields(mandate);
    const catalog = await this.d.catalog.search(mandate.productQuery ?? '', 20);
    const now = (this.d.now ?? (() => new Date()))();
    const offers: EvaluatedOffer[] = [];

    await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const [current] = await tx
        .select()
        .from(mandates)
        .where(and(eq(mandates.id, mandateId), eq(mandates.sessionId, sessionId)))
        .for('update');
      if (current?.status !== 'CONFIRMED') throw stateConflict('Mandate changed while searching.');
      for (const raw of catalog.offers) {
        const snapshotId = randomUUID();
        const observedAt = now;
        const amount = raw.unitAmountMinor === null ? null : BigInt(raw.unitAmountMinor);
        const [snapshot] = await tx
          .insert(offerSnapshots)
          .values({
            id: snapshotId,
            mandateId,
            source: catalog.source,
            sourceProductId: raw.sourceProductId,
            title: raw.title,
            brand: raw.brand,
            merchantName: raw.merchantName,
            merchantDomain: raw.merchantDomain,
            offerUrl: raw.offerUrl,
            unitAmountMinor: amount,
            currency: raw.currency,
            recurrenceSignal: raw.recurrenceSignal,
            recurrenceEvidence: raw.recurrenceEvidence,
            rawSha256: raw.rawSha256,
            observedAt,
          })
          .returning();
        if (!snapshot) throw new Error('offer snapshot insert returned no row');

        const result = evaluate(fields, raw, this.d.policyVersion, now);
        await tx.insert(evaluations).values({
          id: randomUUID(),
          offerSnapshotId: snapshotId,
          decision: result.decision,
          findings: result.findings,
          policyVersion: result.policyVersion,
          evaluatedAt: now,
        });
        await appendAudit(tx, {
          sessionId,
          mandateId,
          type: 'OFFER_EVALUATED',
          payload: {
            snapshotId,
            decision: result.decision,
            findings: result.findings,
            policyVersion: result.policyVersion,
            source: catalog.source,
          },
        });
        const unit = amount;
        const total =
          unit === null || mandate.quantity === null ? null : unit * BigInt(mandate.quantity);
        offers.push({
          snapshotId,
          source: catalog.source,
          title: raw.title,
          brand: raw.brand ?? undefined,
          merchantName: raw.merchantName ?? undefined,
          merchantDomain: raw.merchantDomain ?? undefined,
          offerUrl: raw.offerUrl ?? undefined,
          unitPrice: unit === null ? undefined : toMoney(unit),
          totalPrice: total === null ? undefined : toMoney(total),
          recurrenceSignal: raw.recurrenceSignal,
          decision: result.decision,
          findings: result.findings,
          policyVersion: result.policyVersion,
          observedAt: now.toISOString(),
          seeded: false,
        });
      }
    });

    return { source: catalog.source, offers };
  }
}

export function snapshotToNormalizedOffer(
  snapshot: typeof offerSnapshots.$inferSelect,
): NormalizedOffer {
  return {
    sourceProductId: snapshot.sourceProductId,
    title: snapshot.title,
    brand: snapshot.brand,
    merchantName: snapshot.merchantName,
    merchantDomain: snapshot.merchantDomain,
    offerUrl: snapshot.offerUrl,
    unitAmountMinor: snapshot.unitAmountMinor?.toString() ?? null,
    currency: snapshot.currency,
    recurrenceSignal: snapshot.recurrenceSignal,
    recurrenceEvidence: snapshot.recurrenceEvidence,
    rawSha256: snapshot.rawSha256,
  };
}

export function mandateFields(row: typeof mandates.$inferSelect): MandateFields {
  if (
    row.status !== 'CONFIRMED' ||
    row.productQuery === null ||
    row.quantity === null ||
    row.maxTotalMinor === null ||
    row.currency !== 'USD' ||
    row.allowedMerchantDomains.length === 0
  ) {
    throw stateConflict('Mandate is incomplete.');
  }
  return {
    productQuery: row.productQuery,
    quantity: row.quantity,
    maxTotal: formatUsd(row.maxTotalMinor),
    currency: 'USD',
    allowedMerchantDomains: row.allowedMerchantDomains,
    recurringAllowed: row.recurringAllowed,
    excludedTerms: row.excludedTerms,
  };
}
