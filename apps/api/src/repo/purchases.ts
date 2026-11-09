import { and, eq, sql } from 'drizzle-orm';
import type { Purchase, PurchaseState } from '@intentlock/shared';
import { toMoney } from '../core/money';
import type { Db } from './db';
import { auditEvents, mandates, offerSnapshots, purchases, type PurchaseRow } from './schema';

export type PurchasePatch = Partial<
  Pick<
    PurchaseRow,
    | 'paypalOrderId'
    | 'paypalCaptureId'
    | 'paypalStatus'
    | 'blockReasons'
    | 'approvedAt'
    | 'approvalExpiresAt'
    | 'simulatedDrift'
  >
>;

/** Every read is tenant-scoped: a foreign session id yields the same result as a missing row. */
export async function getPurchase(
  db: Db,
  sessionId: string,
  id: string,
): Promise<PurchaseRow | undefined> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.sessionId, sessionId)));
  return row;
}

export async function purchaseGateEvidence(tx: Db, p: PurchaseRow) {
  const [mandate] = p.mandateId
    ? await tx
        .select()
        .from(mandates)
        .where(and(eq(mandates.id, p.mandateId), eq(mandates.sessionId, p.sessionId)))
        .for('update')
    : [];
  const [snapshot] = p.offerSnapshotId
    ? await tx
        .select()
        .from(offerSnapshots)
        .where(eq(offerSnapshots.id, p.offerSnapshotId))
        .for('update')
    : [];
  const [created] = await tx
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.sessionId, p.sessionId),
        eq(auditEvents.purchaseId, p.id),
        eq(auditEvents.type, 'PURCHASE_CREATED'),
      ),
    )
    .limit(1);
  return { mandate, snapshot, created };
}

/**
 * Compare-and-set transition (architecture section 7.2). Zero rows means another request
 * already moved the purchase, so the caller must treat it as a STATE_CONFLICT.
 */
export async function transitionPurchase(
  db: Db,
  current: Pick<PurchaseRow, 'id' | 'state' | 'version'>,
  next: PurchaseState,
  patch: PurchasePatch = {},
): Promise<PurchaseRow | undefined> {
  const [row] = await db
    .update(purchases)
    .set({ ...patch, state: next, version: sql`${purchases.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(purchases.id, current.id),
        eq(purchases.state, current.state),
        eq(purchases.version, current.version),
      ),
    )
    .returning();
  return row;
}

export function toPurchaseDto(r: PurchaseRow): Purchase {
  return {
    id: r.id,
    mandateId: r.mandateId ?? undefined,
    offerSnapshotId: r.offerSnapshotId ?? undefined,
    mandateHash: r.mandateHash ?? undefined,
    state: r.state,
    quantity: r.quantity,
    itemName: r.itemName,
    unitPrice: toMoney(r.unitAmountMinor),
    total: toMoney(r.totalMinor),
    approvedAt: r.approvedAt?.toISOString(),
    approvalExpiresAt: r.approvalExpiresAt?.toISOString(),
    paypalOrderId: r.paypalOrderId ?? undefined,
    paypalCaptureId: r.paypalCaptureId ?? undefined,
    paypalStatus: r.paypalStatus ?? undefined,
    blockReasons: r.blockReasons ?? undefined,
    simulatedDrift: r.simulatedDrift ?? undefined,
    seeded: r.seeded,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
