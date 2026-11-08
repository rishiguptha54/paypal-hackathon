import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Purchase, PurchaseState } from '@intentlock/shared';
import { toMoney } from '../core/money';
import type { Db } from './db';
import { purchases, type PurchaseRow } from './schema';

export type PurchasePatch = Partial<
  Pick<
    PurchaseRow,
    'paypalOrderId' | 'paypalCaptureId' | 'paypalStatus' | 'blockReasons' | 'approvedAt'
  >
>;

export async function insertPurchase(
  db: Db,
  v: {
    sessionId: string;
    itemName: string;
    quantity: number;
    unitAmountMinor: bigint;
    state: PurchaseState;
    approvedAt?: Date;
    approvalExpiresAt?: Date;
  },
): Promise<PurchaseRow> {
  const [row] = await db
    .insert(purchases)
    .values({
      id: randomUUID(),
      sessionId: v.sessionId,
      itemName: v.itemName,
      quantity: v.quantity,
      unitAmountMinor: v.unitAmountMinor,
      totalMinor: v.unitAmountMinor * BigInt(v.quantity),
      currency: 'USD',
      state: v.state,
      approvedAt: v.approvedAt,
      approvalExpiresAt: v.approvalExpiresAt,
    })
    .returning();
  if (!row) throw new Error('insert purchase returned no row');
  return row;
}

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
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
