import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  FindingSchema,
  IntentReceiptSchema,
  McpTraceSchema,
  type AuditQuery,
  type EvaluatedOffer,
  type LedgerRow,
} from '@intentlock/shared';
import { verifyAuditChain } from '../core/auditHash';
import { toMoney } from '../core/money';
import { AppError, notFound } from '../errors';
import type { Db } from './db';
import { sessionEvents } from './audit';
import { toPurchaseDto } from './purchases';
import {
  auditEvents,
  evaluations,
  mandates,
  offerSnapshots,
  paymentOperations,
  purchases,
  type AuditEventRow,
  type PurchaseRow,
} from './schema';
import { toMandate } from '../services/mandates';

const CursorSchema = z.strictObject({ time: z.iso.datetime(), id: z.uuid() });
type OfferRow = typeof offerSnapshots.$inferSelect;
type EvaluationRow = typeof evaluations.$inferSelect;

export class AuditRepository {
  constructor(private readonly db: Db) {}

  async verify(sessionId: string) {
    return verifyAuditChain(await sessionEvents(this.db, sessionId));
  }

  async ledger(sessionId: string, query: AuditQuery) {
    let cursor: z.infer<typeof CursorSchema> | undefined;
    if (query.cursor) {
      try {
        cursor = CursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()));
      } catch {
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid ledger cursor.');
      }
    }
    // JS timestamps have millisecond precision; use the same precision for keyset ordering.
    const purchaseTime = sql`date_trunc('milliseconds', ${purchases.createdAt})`;
    const offerTime = sql`date_trunc('milliseconds', ${offerSnapshots.observedAt})`;
    const boundary = (
      time: typeof purchaseTime,
      id: typeof purchases.id | typeof offerSnapshots.id | typeof auditEvents.id,
    ) =>
      cursor
        ? or(
            lt(time, new Date(cursor.time)),
            and(eq(time, new Date(cursor.time)), lt(id, cursor.id)),
          )
        : undefined;
    const purchaseDecision = sql<string>`CASE WHEN ${purchases.state} = 'BLOCKED_AT_CAPTURE' THEN 'BLOCKED' ELSE ${evaluations.decision}::text END`;
    const purchaseRows = await this.db
      .select({
        purchase: purchases,
        offer: offerSnapshots,
        evaluation: evaluations,
      })
      .from(purchases)
      .innerJoin(offerSnapshots, eq(purchases.offerSnapshotId, offerSnapshots.id))
      .innerJoin(evaluations, eq(evaluations.offerSnapshotId, offerSnapshots.id))
      .where(
        and(
          eq(purchases.sessionId, sessionId),
          query.decision ? eq(purchaseDecision, query.decision) : undefined,
          query.state ? eq(purchases.state, query.state) : undefined,
          query.seeded === undefined ? undefined : eq(purchases.seeded, query.seeded),
          boundary(purchaseTime, purchases.id),
        ),
      )
      .orderBy(desc(purchaseTime), desc(purchases.id))
      .limit(query.limit + 1);
    const offers = query.state
      ? []
      : await this.db
          .select({
            offer: offerSnapshots,
            evaluation: evaluations,
            mandate: mandates,
          })
          .from(offerSnapshots)
          .innerJoin(mandates, eq(offerSnapshots.mandateId, mandates.id))
          .innerJoin(evaluations, eq(evaluations.offerSnapshotId, offerSnapshots.id))
          .where(
            and(
              eq(mandates.sessionId, sessionId),
              query.decision ? eq(evaluations.decision, query.decision) : undefined,
              query.seeded === undefined ? undefined : eq(mandates.seeded, query.seeded),
              boundary(offerTime, offerSnapshots.id),
            ),
          )
          .orderBy(desc(offerTime), desc(offerSnapshots.id))
          .limit(query.limit + 1);
    const ids = purchaseRows.map(({ purchase }) => purchase.id);
    const rejectionTime = sql`date_trunc('milliseconds', ${auditEvents.createdAt})`;
    const rejections =
      query.state || (query.decision && query.decision !== 'BLOCKED') || query.seeded === true
        ? []
        : await this.db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.sessionId, sessionId),
                eq(auditEvents.type, 'REQUEST_REJECTED'),
                boundary(rejectionTime, auditEvents.id),
              ),
            )
            .orderBy(desc(rejectionTime), desc(auditEvents.id))
            .limit(query.limit + 1);
    const traces = ids.length
      ? await this.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.sessionId, sessionId),
              eq(auditEvents.type, 'PAYPAL_MCP_CALL'),
              inArray(auditEvents.purchaseId, ids),
            ),
          )
      : [];
    const rows: LedgerRow[] = [
      ...rejections.map((event): LedgerRow => ({
        id: event.id,
        time: event.createdAt.toISOString(),
        kind: 'REQUEST_REJECTED',
        product: `Rejected request: ${String(event.payload['route'] ?? 'unknown route')}`,
        merchant: null,
        source: 'none',
        decision: 'BLOCKED',
        reasonCodes: ['REQUEST_REJECTED'],
        approvalHashStatus: 'NONE',
        mcpTraceStatus: 'NONE',
        seeded: false,
      })),
      ...purchaseRows.map(({ purchase: p, offer, evaluation }): LedgerRow => {
        const findings = p.blockReasons ?? FindingSchema.array().parse(evaluation.findings);
        const calls = traces.filter((event) => event.purchaseId === p.id);
        return {
          id: p.id,
          time: p.createdAt.toISOString(),
          kind: 'PURCHASE',
          product: offer.title,
          merchant: offer.merchantDomain,
          source: offer.source,
          decision: p.state === 'BLOCKED_AT_CAPTURE' ? 'BLOCKED' : evaluation.decision,
          reasonCodes: findings.map((f) => f.code),
          approvalHashStatus: !p.approvedAt
            ? 'NONE'
            : findings.some((f) => f.code === 'MANDATE_CHANGED')
              ? 'MISMATCH'
              : ['CAPTURED', 'CAPTURE_PENDING', 'CAPTURE_FAILED', 'CAPTURING'].includes(p.state)
                ? 'VERIFIED'
                : 'LOCKED',
          paypalOrderId: p.paypalOrderId ?? undefined,
          state: p.state,
          total: toMoney(p.totalMinor),
          mcpTraceStatus: traceStatus(calls),
          seeded: p.seeded,
        };
      }),
      ...offers.map(({ offer, evaluation, mandate }): LedgerRow => ({
        id: offer.id,
        time: offer.observedAt.toISOString(),
        kind: 'OFFER',
        product: offer.title,
        merchant: offer.merchantDomain,
        source: offer.source,
        decision: evaluation.decision,
        reasonCodes: FindingSchema.array()
          .parse(evaluation.findings)
          .map((f) => f.code),
        approvalHashStatus: 'NONE',
        mcpTraceStatus: 'NONE',
        seeded: mandate.seeded,
        total:
          offer.unitAmountMinor === null || mandate.quantity === null
            ? undefined
            : toMoney(offer.unitAmountMinor * BigInt(mandate.quantity)),
      })),
    ].sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ time: last.time, id: last.id })).toString('base64url')
          : null,
    };
  }

  async receipt(sessionId: string, id: string, kind: 'PURCHASE' | 'OFFER') {
    const rows: {
      purchase?: PurchaseRow;
      offer: OfferRow;
      evaluation: EvaluationRow;
      mandate: typeof mandates.$inferSelect;
    }[] =
      kind === 'PURCHASE'
        ? await this.db
            .select({
              purchase: purchases,
              offer: offerSnapshots,
              evaluation: evaluations,
              mandate: mandates,
            })
            .from(purchases)
            .innerJoin(mandates, eq(purchases.mandateId, mandates.id))
            .innerJoin(offerSnapshots, eq(purchases.offerSnapshotId, offerSnapshots.id))
            .innerJoin(evaluations, eq(evaluations.offerSnapshotId, offerSnapshots.id))
            .where(and(eq(purchases.id, id), eq(purchases.sessionId, sessionId)))
        : await this.db
            .select({ offer: offerSnapshots, evaluation: evaluations, mandate: mandates })
            .from(offerSnapshots)
            .innerJoin(mandates, eq(offerSnapshots.mandateId, mandates.id))
            .innerJoin(evaluations, eq(evaluations.offerSnapshotId, offerSnapshots.id))
            .where(and(eq(offerSnapshots.id, id), eq(mandates.sessionId, sessionId)));
    const joined = rows[0];
    if (!joined) throw notFound();
    const p = joined.purchase;
    const events = await sessionEvents(this.db, sessionId);
    const relevant = events.filter((event) =>
      event.purchaseId
        ? event.purchaseId === p?.id
        : event.mandateId === joined.mandate.id &&
          (event.type !== 'OFFER_EVALUATED' || event.payload['snapshotId'] === joined.offer.id),
    );
    const traces = relevant
      .filter((event) => event.type === 'PAYPAL_MCP_CALL')
      .map((event) =>
        McpTraceSchema.parse({
          tool: event.payload['mcpTool'],
          status: event.payload['status'],
          durationMs: event.payload['durationMs'],
          at: event.payload['at'] ?? event.createdAt.toISOString(),
          fallbackToRest: event.payload['fallbackToRest'],
        }),
      );
    const ops = p
      ? await this.db
          .select()
          .from(paymentOperations)
          .where(eq(paymentOperations.purchaseId, p.id))
          .orderBy(desc(paymentOperations.updatedAt))
      : [];
    return IntentReceiptSchema.parse({
      requestText: joined.mandate.requestText,
      mandate: toMandate(joined.mandate),
      offer: evaluatedOffer(joined.offer, joined.evaluation, joined.mandate),
      purchase: p ? toPurchaseDto(p) : undefined,
      approval:
        p?.approvedAt && p.approvalExpiresAt && p.mandateHash
          ? {
              mandateHash: p.mandateHash,
              approvedAt: p.approvedAt.toISOString(),
              expiresAt: p.approvalExpiresAt.toISOString(),
            }
          : undefined,
      mcpTrace: traces,
      paypal: p?.paypalOrderId
        ? {
            orderId: p.paypalOrderId,
            captureId: p.paypalCaptureId ?? undefined,
            status: p.paypalStatus ?? 'UNKNOWN',
            debugId: ops.find((op) => op.paypalDebugId)?.paypalDebugId ?? undefined,
          }
        : undefined,
      events: relevant.map((event) => ({
        seq: event.seq.toString(),
        type: event.type,
        createdAt: event.createdAt.toISOString(),
        entryHash: event.entryHash,
      })),
      chain: verifyAuditChain(events).status,
      sandboxNotice: 'PayPal Sandbox only. This is not a real merchant purchase.',
      seeded: joined.mandate.seeded || (p?.seeded ?? false),
    });
  }
}

function evaluatedOffer(
  offer: OfferRow,
  result: EvaluationRow,
  mandate: typeof mandates.$inferSelect,
): EvaluatedOffer {
  return {
    snapshotId: offer.id,
    source: offer.source,
    title: offer.title,
    brand: offer.brand ?? undefined,
    merchantName: offer.merchantName ?? undefined,
    merchantDomain: offer.merchantDomain ?? undefined,
    offerUrl: offer.offerUrl ?? undefined,
    unitPrice: offer.unitAmountMinor === null ? undefined : toMoney(offer.unitAmountMinor),
    totalPrice:
      offer.unitAmountMinor === null || mandate.quantity === null
        ? undefined
        : toMoney(offer.unitAmountMinor * BigInt(mandate.quantity)),
    recurrenceSignal: offer.recurrenceSignal,
    decision: result.decision,
    findings: FindingSchema.array().parse(result.findings),
    policyVersion: result.policyVersion,
    observedAt: offer.observedAt.toISOString(),
    seeded: mandate.seeded,
  };
}

function traceStatus(events: AuditEventRow[]): LedgerRow['mcpTraceStatus'] {
  if (!events.length) return 'NONE';
  if (events.some((e) => e.payload['status'] !== 'OK' && !e.payload['fallbackToRest']))
    return 'ERROR';
  if (events.some((e) => e.payload['fallbackToRest'])) return 'FALLBACK_REST';
  return 'OK';
}
