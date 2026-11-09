import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { MandateHashFields, Purchase } from '@intentlock/shared';
import { mandateHash } from '../core/mandateHash';
import { evaluate } from '../core/policy';
import { notFound, AppError, stateConflict } from '../errors';
import type { Db } from '../repo/db';
import { getPurchase, toPurchaseDto, transitionPurchase } from '../repo/purchases';
import { mandates, offerSnapshots, purchases } from '../repo/schema';
import { mandateFields, snapshotToNormalizedOffer } from './offers';
import { canTransitionPurchase } from '../core/stateMachine';
import { appendAudit, lockSession } from '../repo/audit';

export class PurchaseApiService {
  constructor(
    private readonly d: {
      db: Db;
      policyVersion: string;
      approvalTtlSeconds: number;
      now?: () => Date;
    },
  ) {}

  async create(sessionId: string, mandateId: string, offerSnapshotId: string): Promise<Purchase> {
    const row = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const [mandate] = await tx
        .select()
        .from(mandates)
        .where(and(eq(mandates.id, mandateId), eq(mandates.sessionId, sessionId)))
        .for('update');
      if (!mandate) throw notFound();
      if (mandate.seeded) throw stateConflict('Sample history cannot be used for a real checkout.');
      const [snapshot] = await tx
        .select()
        .from(offerSnapshots)
        .where(
          and(eq(offerSnapshots.id, offerSnapshotId), eq(offerSnapshots.mandateId, mandateId)),
        );
      if (!snapshot) throw notFound();

      const fields = mandateFields(mandate);
      const offer = snapshotToNormalizedOffer(snapshot);
      const now = (this.d.now ?? (() => new Date()))();
      const result = evaluate(fields, offer, this.d.policyVersion, now);
      if (result.decision !== 'ALLOWED') {
        throw new AppError(
          409,
          'POLICY_BLOCKED',
          'Offer is not allowed by the confirmed mandate.',
          [
            ...result.findings.map((f) => ({
              code: f.code,
              severity: f.severity,
              message: f.message,
            })),
          ],
        );
      }
      if (snapshot.unitAmountMinor === null || !snapshot.merchantDomain) {
        throw new AppError(409, 'POLICY_BLOCKED', 'Offer price or merchant could not be verified.');
      }
      const total = snapshot.unitAmountMinor * BigInt(fields.quantity);
      const hashFields: MandateHashFields = {
        mandateId: mandate.id,
        mandateVersion: mandate.version,
        offerId: snapshot.id,
        merchantDomain: snapshot.merchantDomain,
        quantity: fields.quantity,
        unitPriceMinor: snapshot.unitAmountMinor.toString(),
        totalMinor: total.toString(),
        currency: fields.currency,
        recurring: snapshot.recurrenceSignal === 'RECURRING',
      };
      const hash = mandateHash(hashFields);

      const [purchase] = await tx
        .insert(purchases)
        .values({
          id: randomUUID(),
          sessionId,
          mandateId,
          offerSnapshotId,
          mandateHash: hash,
          itemName: snapshot.title,
          quantity: fields.quantity,
          unitAmountMinor: snapshot.unitAmountMinor,
          totalMinor: total,
          currency: fields.currency,
          state: 'PENDING_APPROVAL',
        })
        .returning();
      if (!purchase) throw new Error('purchase insert returned no row');
      await appendAudit(tx, {
        sessionId,
        mandateId,
        purchaseId: purchase.id,
        type: 'PURCHASE_CREATED',
        payload: {
          totalMinor: total.toString(),
          mandateHash: hash,
          merchantDomain: snapshot.merchantDomain,
        },
      });
      return purchase;
    });
    return toPurchaseDto(row);
  }

  async approve(sessionId: string, id: string, echoedHash: string): Promise<Purchase> {
    const row = await getPurchase(this.d.db, sessionId, id);
    if (!row) throw notFound();
    if (row.mandateHash !== echoedHash) {
      throw new AppError(
        409,
        'MANDATE_HASH_MISMATCH',
        'Approval hash does not match this purchase.',
      );
    }
    if (row.state === 'APPROVED' && row.approvedAt && row.approvalExpiresAt) {
      return toPurchaseDto(row);
    }
    if (row.state !== 'PENDING_APPROVAL') {
      throw stateConflict('Purchase is not awaiting approval.');
    }
    const now = (this.d.now ?? (() => new Date()))();
    const updated = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const updated = await transitionPurchase(tx, row, 'APPROVED', {
        approvedAt: now,
        approvalExpiresAt: new Date(now.getTime() + this.d.approvalTtlSeconds * 1000),
      });
      if (!updated) throw stateConflict('Purchase changed while approving.');
      await appendAudit(tx, {
        sessionId,
        mandateId: row.mandateId,
        purchaseId: id,
        type: 'PURCHASE_APPROVED',
        payload: {
          mandateHash: row.mandateHash,
          approvedAt: updated.approvedAt?.toISOString(),
          expiresAt: updated.approvalExpiresAt?.toISOString(),
        },
      });
      return updated;
    });
    return toPurchaseDto(updated);
  }

  async cancel(sessionId: string, id: string): Promise<Purchase> {
    const row = await getPurchase(this.d.db, sessionId, id);
    if (!row) throw notFound();
    if (!canTransitionPurchase(row.state, 'CANCELLED')) {
      throw stateConflict('Purchase cannot be cancelled in its current state.');
    }
    const updated = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const updated = await transitionPurchase(tx, row, 'CANCELLED');
      if (!updated) throw stateConflict('Purchase cannot be cancelled in its current state.');
      await appendAudit(tx, {
        sessionId,
        mandateId: row.mandateId,
        purchaseId: id,
        type: 'PURCHASE_CANCELLED',
        payload: { reason: 'USER_CANCELLED' },
      });
      return updated;
    });
    return toPurchaseDto(updated);
  }
}
