import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { AnalyticsDatasetSchema, type AnalyticsRow } from '@intentlock/shared';
import type { Db } from './db';
import { auditEvents, evaluations, mandates, offerSnapshots, purchases } from './schema';
import { appendAudit } from './audit';

export class AnalyticsRepository {
  constructor(private readonly db: Db) {}

  async rejectedTools(sessionId: string, names: string[]) {
    await this.db.transaction(async (tx) => {
      await appendAudit(tx, {
        sessionId, type: 'REQUEST_REJECTED',
        payload: { route: 'POST /api/studio-agent/turn', rejectedTools: names },
      });
    });
  }

  async dataset(sessionId: string, days: number) {
    const offers = await this.db.select({
      offer: offerSnapshots, evaluation: evaluations, mandate: mandates,
    }).from(evaluations)
      .innerJoin(offerSnapshots, eq(evaluations.offerSnapshotId, offerSnapshots.id))
      .innerJoin(mandates, eq(offerSnapshots.mandateId, mandates.id))
      .where(and(eq(mandates.sessionId, sessionId),
        gte(evaluations.evaluatedAt, new Date(Date.now() - days * 86_400_000))))
      .orderBy(desc(evaluations.evaluatedAt), desc(evaluations.id)).limit(5000);
    if (!offers.length) return { rows: [] };
    const purchaseRows = await this.db.select().from(purchases)
      .where(and(eq(purchases.sessionId, sessionId),
        inArray(purchases.offerSnapshotId, offers.map(({ offer }) => offer.id))))
      .orderBy(desc(purchases.createdAt), desc(purchases.id));
    // One evaluation stays one row. Prefer an actual capture, otherwise the latest attempt.
    const selected = new Map<string, typeof purchases.$inferSelect>();
    for (const p of purchaseRows) {
      if (!p.offerSnapshotId) continue;
      const current = selected.get(p.offerSnapshotId);
      if (!current || (p.state === 'CAPTURED' && current.state !== 'CAPTURED'))
        selected.set(p.offerSnapshotId, p);
    }
    const ids = [...selected.values()].map((p) => p.id);
    const traces = ids.length ? await this.db.select().from(auditEvents).where(and(
      eq(auditEvents.sessionId, sessionId), eq(auditEvents.type, 'PAYPAL_MCP_CALL'),
      inArray(auditEvents.purchaseId, ids),
    )) : [];
    const rows: AnalyticsRow[] = offers.map(({ offer, evaluation, mandate }) => {
      const p = selected.get(offer.id);
      const calls = traces.filter((event) => event.purchaseId === p?.id);
      const captured = p?.state === 'CAPTURED';
      return {
        time: evaluation.evaluatedAt.toISOString(),
        day: evaluation.evaluatedAt.toISOString().slice(0, 10),
        productQuery: mandate.productQuery ?? offer.title,
        merchantDomain: offer.merchantDomain ?? undefined,
        source: offer.source, decision: evaluation.decision,
        primaryReason: evaluation.findings.find((f) => f.severity === 'BLOCKING')?.code
          ?? evaluation.findings[0]?.code ?? 'ALLOWED',
        reasonCodes: evaluation.findings.map((f) => f.code),
        offerTotalMinor: offer.unitAmountMinor === null || mandate.quantity === null
          ? undefined : (offer.unitAmountMinor * BigInt(mandate.quantity)).toString(),
        approved: !!p?.approvedAt, purchaseState: p?.state,
        capturedTotalMinor: captured ? p.totalMinor.toString() : undefined,
        blockedAtCapture: p?.state === 'BLOCKED_AT_CAPTURE',
        captureBlockCodes: (p?.blockReasons ?? []).map((f) => f.code),
        mcpTraceStatus: !calls.length ? 'NONE'
          : calls.some((c) => c.payload['status'] !== 'OK' && !c.payload['fallbackToRest']) ? 'ERROR'
          : calls.some((c) => c.payload['fallbackToRest']) ? 'FALLBACK_REST' : 'OK',
        approvalToCaptureSeconds: captured && p.approvedAt
          ? Math.max(0, (p.updatedAt.getTime() - p.approvedAt.getTime()) / 1000) : undefined,
        policyVersion: evaluation.policyVersion, seeded: mandate.seeded || !!p?.seeded,
      };
    });
    return AnalyticsDatasetSchema.parse({ rows });
  }
}
