import { createHash } from 'node:crypto';

export const AUDIT_GENESIS = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Audit values must be JSON');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export interface AuditHashInput {
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  sessionId: string;
  purchaseId: string | null;
}

export function auditHash(prevHash: string, event: AuditHashInput): string {
  return createHash('sha256')
    .update(
      prevHash +
        canonicalJson({
          type: event.type,
          payload: event.payload,
          created_at: event.createdAt.toISOString(),
          session_id: event.sessionId,
          purchase_id: event.purchaseId,
        }),
    )
    .digest('hex');
}

export function verifyAuditChain(
  events: readonly (AuditHashInput & {
    seq: bigint;
    prevHash: string;
    entryHash: string;
  })[],
) {
  let previous = AUDIT_GENESIS;
  for (const [index, event] of events.entries()) {
    if (event.prevHash !== previous || event.entryHash !== auditHash(previous, event)) {
      return {
        status: 'BROKEN' as const,
        checked: index + 1,
        firstBrokenSeq: event.seq.toString(),
        firstBrokenIndex: index,
      };
    }
    previous = event.entryHash;
  }
  return { status: 'INTACT' as const, checked: events.length };
}
