import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import { paymentOperations, type PaymentOperationRow } from './schema';

/** A STARTED operation older than this is treated as abandoned (crashed process). */
export const STALE_OPERATION_SECONDS = 60;

type Kind = PaymentOperationRow['kind'];
type Channel = PaymentOperationRow['channel'];

export interface ClaimedOperation {
  op: PaymentOperationRow;
  /** True when this caller owns the in-flight attempt and may call PayPal. */
  claimed: boolean;
}

/**
 * Get-or-create the single operation for (purchase, kind). The PayPal-Request-Id is minted
 * once and reused on every retry. Only one caller can hold the in-flight claim, so two
 * concurrent requests never both call PayPal.
 */
export async function claimOperation(
  db: Db,
  v: { purchaseId: string; kind: Kind; channel: Channel; mcpTool: string | null },
): Promise<ClaimedOperation> {
  const inserted = await db
    .insert(paymentOperations)
    .values({
      id: randomUUID(),
      purchaseId: v.purchaseId,
      kind: v.kind,
      channel: v.channel,
      mcpTool: v.mcpTool,
      paypalRequestId: randomUUID(),
      status: 'STARTED',
    })
    .onConflictDoNothing({ target: [paymentOperations.purchaseId, paymentOperations.kind] })
    .returning();
  if (inserted[0]) return { op: inserted[0], claimed: true };

  const [existing] = await db
    .select()
    .from(paymentOperations)
    .where(and(eq(paymentOperations.purchaseId, v.purchaseId), eq(paymentOperations.kind, v.kind)));
  if (!existing) throw new Error('payment operation vanished after conflict');
  if (existing.status === 'SUCCEEDED') return { op: existing, claimed: false };

  const [reclaimed] = await db
    .update(paymentOperations)
    .set({ status: 'STARTED', errorCode: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(paymentOperations.id, existing.id),
        or(
          eq(paymentOperations.status, 'FAILED'),
          and(
            eq(paymentOperations.status, 'STARTED'),
            sql`${paymentOperations.updatedAt} < now() - make_interval(secs => ${STALE_OPERATION_SECONDS})`,
          ),
        ),
      ),
    )
    .returning();
  return reclaimed ? { op: reclaimed, claimed: true } : { op: existing, claimed: false };
}

export async function finishOperation(
  db: Db,
  id: string,
  v: {
    status: 'SUCCEEDED' | 'FAILED';
    channel?: Channel;
    mcpTool?: string | null;
    httpStatus?: number;
    paypalDebugId?: string;
    errorCode?: string;
  },
): Promise<void> {
  await db
    .update(paymentOperations)
    .set({
      status: v.status,
      ...(v.channel !== undefined && { channel: v.channel }),
      ...(v.mcpTool !== undefined && { mcpTool: v.mcpTool }),
      httpStatus: v.httpStatus ?? null,
      paypalDebugId: v.paypalDebugId ?? null,
      errorCode: v.errorCode ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentOperations.id, id));
}

export async function getOperation(
  db: Db,
  purchaseId: string,
  kind: Kind,
): Promise<PaymentOperationRow | undefined> {
  const [row] = await db
    .select()
    .from(paymentOperations)
    .where(and(eq(paymentOperations.purchaseId, purchaseId), eq(paymentOperations.kind, kind)));
  return row;
}
