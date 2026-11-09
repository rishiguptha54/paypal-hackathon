import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { AUDIT_GENESIS, auditHash } from '../core/auditHash';
import { notFound } from '../errors';
import type { Db } from './db';
import { auditEvents, sessions } from './schema';

export async function lockSession(tx: Db, sessionId: string) {
  const [session] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .for('update');
  if (!session) throw notFound();
}

export type AuditType =
  | 'MANDATE_DRAFTED'
  | 'MANDATE_CONFIRMED'
  | 'OFFER_EVALUATED'
  | 'PURCHASE_CREATED'
  | 'PURCHASE_APPROVED'
  | 'REQUEST_REJECTED'
  | 'PAYPAL_MCP_CALL'
  | 'PAYPAL_ORDER_CREATED'
  | 'DRIFT_SIMULATED'
  | 'CAPTURE_BLOCKED'
  | 'PAYPAL_CAPTURED'
  | 'PAYPAL_CAPTURE_PENDING'
  | 'PAYPAL_CAPTURE_FAILED'
  | 'PAYPAL_INSTRUMENT_DECLINED'
  | 'PURCHASE_CANCELLED'
  | 'PURCHASE_EXPIRED'
  | 'DEMO_SEEDED';

/** Call only inside the state-changing transaction; session lock is always acquired first. */
export async function appendAudit(
  tx: Db,
  input: {
    sessionId: string;
    mandateId?: string | null;
    purchaseId?: string | null;
    type: AuditType;
    payload: Record<string, unknown>;
  },
) {
  await lockSession(tx, input.sessionId);
  const [last] = await tx
    .select({ entryHash: auditEvents.entryHash })
    .from(auditEvents)
    .where(eq(auditEvents.sessionId, input.sessionId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const prevHash = last?.entryHash ?? AUDIT_GENESIS;
  // Round-trip through JSON so hashing sees exactly what jsonb will store (no undefined).
  const payload: Record<string, unknown> = JSON.parse(JSON.stringify(input.payload));
  const event = { ...input, payload, purchaseId: input.purchaseId ?? null, createdAt: new Date() };
  await tx.insert(auditEvents).values({
    ...event,
    id: randomUUID(),
    prevHash,
    entryHash: auditHash(prevHash, event),
  });
}

export async function sessionEvents(db: Db, sessionId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.sessionId, sessionId))
    .orderBy(asc(auditEvents.seq));
}
