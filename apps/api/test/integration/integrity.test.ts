import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FindingSchema,
  IntentReceiptSchema,
  LedgerRowSchema,
  type DriftKind,
} from '@intentlock/shared';
import { buildTestApp } from '../helpers/app';
import { approvedPurchase, pendingPurchase } from '../helpers/flow';
import { sessionClient } from '../helpers/session';
import {
  auditEvents,
  mandates,
  offerSnapshots,
  paymentOperations,
  purchases,
} from '../../src/repo/schema';
import { appendAudit, lockSession } from '../../src/repo/audit';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  ctx = await buildTestApp({ env: { DEMO_CONTROLS_ENABLED: 'true' } });
});
afterAll(async () => {
  await ctx.close();
});

async function ready() {
  const client = sessionClient(ctx.app);
  const p = await approvedPurchase(client);
  const created = await client.post(`/api/purchases/${p.id}/paypal/create-order`);
  expect(created.status).toBe(200);
  const orderId: string = created.body.paypalOrderId;
  ctx.fake.approve(orderId);
  return {
    client,
    p,
    orderId,
    capture: () => client.post(`/api/purchases/${p.id}/paypal/capture`, { paypalOrderId: orderId }),
  };
}

describe('Stage 3 capture integrity', () => {
  it('INT-03 requires human approval and an existing order before any payment call', async () => {
    const client = sessionClient(ctx.app);
    const p = await pendingPurchase(client);
    const before = ctx.fake.calls.length;
    expect((await client.post(`/api/purchases/${p.id}/paypal/create-order`)).status).toBe(409);
    expect(
      (
        await client.post(`/api/purchases/${p.id}/paypal/capture`, {
          paypalOrderId: 'ABCDEFGHIJKLMNOPQ',
        })
      ).status,
    ).toBe(409);
    expect(
      (await client.post(`/api/purchases/${p.id}/simulate-drift`, { kind: 'PRICE_HIKE' })).status,
    ).toBe(409);
    expect(ctx.fake.calls).toHaveLength(before);
    expect(
      (await client.post(`/api/purchases/${p.id}/approve`, { mandateHash: p.mandateHash })).status,
    ).toBe(200);
    expect(
      (
        await client.post(`/api/purchases/${p.id}/paypal/capture`, {
          paypalOrderId: 'ABCDEFGHIJKLMNOPQ',
        })
      ).status,
    ).toBe(409);
    expect(ctx.fake.calls).toHaveLength(before);
  });

  it('INT-01 captures after all gates, writes ordered evidence and returns an intact receipt', async () => {
    const { client, p, capture } = await ready();
    const captured = await capture();
    expect(captured.status).toBe(200);
    expect(captured.body.state).toBe('CAPTURED');
    const receipt = IntentReceiptSchema.parse(
      (await client.get(`/api/purchases/${p.id}/receipt`)).body,
    );
    expect(receipt.chain).toBe('INTACT');
    expect(receipt.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'MANDATE_DRAFTED',
        'MANDATE_CONFIRMED',
        'OFFER_EVALUATED',
        'PURCHASE_CREATED',
        'PURCHASE_APPROVED',
        'PAYPAL_MCP_CALL',
        'PAYPAL_ORDER_CREATED',
        'PAYPAL_CAPTURED',
      ]),
    );
    expect(receipt.mcpTrace.map((trace) => trace.tool)).toEqual(['create_order', 'get_order']);
    expect(receipt.mcpTrace.every((trace) => trace.fallbackToRest)).toBe(true);
    expect(receipt.events.at(-1)?.type).toBe('PAYPAL_CAPTURED');
    const verify = await client.get('/api/audit/verify');
    expect(verify.body.status).toBe('INTACT');
    expect(verify.body.checked).toBeGreaterThan(10);
  });

  it.each<DriftKind>(['PRICE_HIKE', 'MERCHANT_SWAP', 'APPROVAL_EXPIRED'])(
    'INT-23 %s blocks without modifying protected rows',
    async (kind) => {
      const { client, p, capture } = await ready();
      const [before] = await ctx.db
        .select()
        .from(offerSnapshots)
        .where(eq(offerSnapshots.id, p.offerSnapshotId!));
      const calls = ctx.fake.callsTo('POST', '/capture').length;
      const simulated = await client.post(`/api/purchases/${p.id}/simulate-drift`, { kind });
      expect(simulated.status).toBe(200);
      expect(simulated.body.mandateHash).toBe(p.mandateHash);
      expect(simulated.body.simulatedDrift).toBe(kind);
      const blocked = await capture();
      const code =
        kind === 'PRICE_HIKE'
          ? 'DRIFT_AMOUNT_MISMATCH'
          : kind === 'MERCHANT_SWAP'
            ? 'DRIFT_MERCHANT_MISMATCH'
            : 'APPROVAL_EXPIRED';
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details).toContainEqual({ code });
      expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(calls);
      const [after] = await ctx.db
        .select()
        .from(offerSnapshots)
        .where(eq(offerSnapshots.id, p.offerSnapshotId!));
      expect(after).toEqual(before);
      const read = await client.get(`/api/purchases/${p.id}`);
      expect(read.body.state).toBe('BLOCKED_AT_CAPTURE');
      FindingSchema.array().parse(read.body.blockReasons);
      const receipt = await client.get(`/api/purchases/${p.id}/receipt`);
      expect(receipt.body.events.map((event: { type: string }) => event.type)).toEqual(
        expect.arrayContaining(['DRIFT_SIMULATED', 'CAPTURE_BLOCKED']),
      );
      expect(receipt.body.chain).toBe('INTACT');
      expect((await client.get('/api/audit/verify')).body.status).toBe('INTACT');
      expect((await client.post(`/api/purchases/${p.id}/simulate-drift`, { kind })).status).toBe(
        409,
      );
    },
  );

  it.each([
    ['INT-06 custom ID', 'CUSTOM_ID_MISMATCH'],
    ['INT-07 merchant', 'DRIFT_MERCHANT_MISMATCH'],
    ['G6 policy', 'POLICY_NOW_BLOCKS'],
    ['INT-08 TTL', 'APPROVAL_EXPIRED'],
    ['G5 snapshot price', 'MANDATE_CHANGED'],
    ['G5 superseded mandate', 'MANDATE_CHANGED'],
  ])('%s drift is rejected with %s', async (scenario, reason) => {
    const { p, orderId, capture } = await ready();
    if (scenario.includes('custom ID')) ctx.fake.orders.get(orderId)!.customId = 'foreign';
    if (scenario.includes('merchant'))
      await ctx.db
        .update(offerSnapshots)
        .set({ merchantDomain: 'unapproved.example' })
        .where(eq(offerSnapshots.id, p.offerSnapshotId!));
    if (scenario.includes('policy'))
      await ctx.db.update(mandates).set({ maxTotalMinor: 1n }).where(eq(mandates.id, p.mandateId!));
    if (scenario.includes('TTL'))
      await ctx.db
        .update(purchases)
        .set({ approvalExpiresAt: new Date(0) })
        .where(eq(purchases.id, p.id));
    if (scenario.includes('price'))
      await ctx.db
        .update(offerSnapshots)
        .set({ unitAmountMinor: null })
        .where(eq(offerSnapshots.id, p.offerSnapshotId!));
    if (scenario.includes('superseded'))
      await ctx.db
        .update(mandates)
        .set({ status: 'SUPERSEDED' })
        .where(eq(mandates.id, p.mandateId!));
    const calls = ctx.fake.callsTo('POST', '/capture').length;
    const result = await capture();
    expect(result.status).toBe(409);
    expect(result.body.error.details).toContainEqual({ code: reason });
    if (scenario.includes('merchant'))
      expect(result.body.error.details).toContainEqual({ code: 'MANDATE_CHANGED' });
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(calls);
  });

  it('INT-10 ten simultaneous attempts make exactly one REST capture call', async () => {
    const { capture } = await ready();
    const before = ctx.fake.callsTo('POST', '/capture').length;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.fake.beforeCapture = () => barrier;
    let settled = 0;
    let responses;
    try {
      responses = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const response = await capture();
          if (++settled === 9) release();
          return response;
        }),
      );
    } finally {
      release();
      ctx.fake.beforeCapture = undefined;
    }
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(before + 1);
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 409)).toHaveLength(9);
  });

  it('INT-11/16 reconciles a timed-out attempt before permitting a retry with the same request ID', async () => {
    const { p, client, capture } = await ready();
    ctx.fake.captureMode = 'TIMEOUT';
    expect((await capture()).status).toBe(504);
    ctx.fake.captureMode = 'COMPLETED';
    expect((await capture()).status).toBe(409);
    await ctx.db
      .update(purchases)
      .set({ updatedAt: new Date(Date.now() - 61_000) })
      .where(eq(purchases.id, p.id));
    const recovered = await client.get(`/api/purchases/${p.id}`);
    expect(recovered.body.state).toBe('ORDER_CREATED');
    expect((await capture()).body.state).toBe('CAPTURED');
    const ids = ctx.fake
      .callsTo('POST', `/orders/${recovered.body.paypalOrderId}/capture`)
      .map((call) => call.headers['paypal-request-id']);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('INT-16 reconciles a completed capture after a process restart without another capture call', async () => {
    const { p, client, orderId } = await ready();
    const order = ctx.fake.orders.get(orderId)!;
    order.status = 'COMPLETED';
    order.captures = [
      {
        id: `RECON${orderId}`,
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: order.total },
      },
    ];
    await ctx.db
      .update(purchases)
      .set({ state: 'CAPTURING', updatedAt: new Date(Date.now() - 61_000) })
      .where(eq(purchases.id, p.id));
    const calls = ctx.fake.callsTo('POST', '/capture').length;
    const result = await client.get(`/api/purchases/${p.id}`);
    expect(result.body).toMatchObject({
      state: 'CAPTURED',
      paypalCaptureId: `RECON${orderId}`,
      paypalStatus: 'COMPLETED',
    });
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(calls);
    expect((await client.get(`/api/purchases/${p.id}/receipt`)).body.events.at(-1).type).toBe(
      'PAYPAL_CAPTURED',
    );
  });

  it('reconciles PENDING truthfully and never trusts an order status without capture evidence', async () => {
    const { p, client, orderId, capture } = await ready();
    ctx.fake.captureMode = 'PENDING';
    expect((await capture()).body.state).toBe('CAPTURE_PENDING');
    ctx.fake.captureMode = 'COMPLETED';
    const order = ctx.fake.orders.get(orderId)!;
    order.status = 'COMPLETED';
    order.captures![0]!.status = 'COMPLETED';
    expect((await client.get(`/api/purchases/${p.id}`)).body.state).toBe('CAPTURED');
    const other = await ready();
    ctx.fake.orders.get(other.orderId)!.status = 'COMPLETED';
    await ctx.db
      .update(purchases)
      .set({ state: 'CAPTURING', updatedAt: new Date(0) })
      .where(eq(purchases.id, other.p.id));
    expect((await other.client.get(`/api/purchases/${other.p.id}`)).body.state).toBe('CAPTURING');
  });

  it('INT-13 records instrument decline and retains the original capture operation', async () => {
    const { p, client, capture } = await ready();
    ctx.fake.captureMode = 'DECLINE';
    expect((await capture()).body.error.code).toBe('INSTRUMENT_DECLINED');
    ctx.fake.captureMode = 'COMPLETED';
    expect((await client.get(`/api/purchases/${p.id}`)).body.state).toBe('ORDER_CREATED');
    expect((await capture()).body.state).toBe('CAPTURED');
    const receipt = await client.get(`/api/purchases/${p.id}/receipt`);
    expect(receipt.body.events.map((event: { type: string }) => event.type)).toContain(
      'PAYPAL_INSTRUMENT_DECLINED',
    );
    const ops = await ctx.db
      .select()
      .from(paymentOperations)
      .where(and(eq(paymentOperations.purchaseId, p.id), eq(paymentOperations.kind, 'CAPTURE')));
    expect(ops).toHaveLength(1);
  });

  it('does not reconcile a capture with a different amount or purchase binding', async () => {
    const { p, client, orderId } = await ready();
    const order = ctx.fake.orders.get(orderId)!;
    order.status = 'COMPLETED';
    order.captures = [
      {
        id: 'foreign-capture',
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '1.00' },
      },
    ];
    await ctx.db
      .update(purchases)
      .set({ state: 'CAPTURING', updatedAt: new Date(0) })
      .where(eq(purchases.id, p.id));
    const before = ctx.fake.callsTo('POST', '/capture').length;
    expect((await client.get(`/api/purchases/${p.id}`)).status).toBe(502);
    order.customId = 'foreign-purchase';
    expect((await client.get(`/api/purchases/${p.id}`)).status).toBe(502);
    const [row] = await ctx.db.select().from(purchases).where(eq(purchases.id, p.id));
    expect(row?.state).toBe('CAPTURING');
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(before);
  });
});

describe('Session audit ledger, receipts and sample history', () => {
  it('SEC-01 audits strict-schema rejection using field names only', async () => {
    const client = sessionClient(ctx.app);
    const result = await client.post('/api/purchases', {
      total: 'secret-value-not-for-audit',
      decision: 'ALLOWED',
    });
    expect(result.body.error.code).toBe('UNEXPECTED_FIELD');
    const events = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.type, 'REQUEST_REJECTED'));
    const event = events.find((e) => e.payload['route'] === 'POST /api/purchases');
    expect(event?.payload['unexpectedFields']).toEqual(['total', 'decision']);
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain(
      'secret-value-not-for-audit',
    );
    expect((await client.get('/api/audit/verify')).body).toEqual({ status: 'INTACT', checked: 1 });
  });

  it('INT-24 seeds once per session, labels every sample, and makes zero external calls', async () => {
    const client = sessionClient(ctx.app);
    const before = ctx.fake.calls.length;
    const first = await client.post('/api/demo/seed');
    const verify = await client.get('/api/audit/verify');
    const second = await client.post('/api/demo/seed');
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(first.body.seeded).toEqual({ mandates: 1, evaluations: 4, purchases: 2 });
    expect((await client.get('/api/audit/verify')).body).toEqual(verify.body);
    expect(verify.body.status).toBe('INTACT');
    expect(ctx.fake.calls).toHaveLength(before);
    const page = await client.get('/api/audit?seeded=true');
    const rows = LedgerRowSchema.array().parse(page.body.rows);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.seeded)).toBe(true);
    expect(rows.flatMap((row) => row.reasonCodes)).toEqual(
      expect.arrayContaining([
        'VENDOR_NOT_APPROVED',
        'RECURRING_NOT_ALLOWED',
        'DRIFT_AMOUNT_MISMATCH',
      ]),
    );
    const p = rows.find((row) => row.kind === 'PURCHASE' && row.state === 'CAPTURED')!;
    const receipt = IntentReceiptSchema.parse(
      (await client.get(`/api/purchases/${p.id}/receipt`)).body,
    );
    expect(receipt.seeded).toBe(true);
    expect(receipt.paypal).toBeUndefined();
    expect(receipt.mcpTrace).toEqual([]);
    expect((await client.post(`/api/purchases/${p.id}/paypal/create-order`)).status).toBe(409);
    expect(
      (
        await client.post(`/api/purchases/${p.id}/paypal/capture`, {
          paypalOrderId: 'ABCDEFGHIJKLMNOPQ',
        })
      ).status,
    ).toBe(409);
    expect(ctx.fake.calls).toHaveLength(before);
  });

  it('serializes simultaneous seed requests and audit appends within a session', async () => {
    const client = sessionClient(ctx.app);
    await client.get('/api/config');
    const responses = await Promise.all([
      client.post('/api/demo/seed'),
      client.post('/api/demo/seed'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect((await client.get('/api/audit/verify')).body.status).toBe('INTACT');
    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.type, 'DEMO_SEEDED'))
      .limit(1);
    expect(event).toBeDefined();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        ctx.db.transaction(async (tx) => {
          await lockSession(tx, event!.sessionId);
          await appendAudit(tx, {
            sessionId: event!.sessionId,
            type: 'REQUEST_REJECTED',
            payload: { test: index },
          });
        }),
      ),
    );
    const service = new (await import('../../src/repo/auditViews')).AuditRepository(ctx.db);
    expect((await service.verify(event!.sessionId)).status).toBe('INTACT');
  });

  it('paginates without duplicates or omissions and filters by decision/state/seeded', async () => {
    const client = sessionClient(ctx.app);
    await client.post('/api/demo/seed');
    const original = await client.get('/api/audit');
    const purchaseIds = original.body.rows
      .filter((row: { kind: string }) => row.kind === 'PURCHASE')
      .map((row: { id: string }) => row.id);
    const offerIds = original.body.rows
      .filter((row: { kind: string }) => row.kind === 'OFFER')
      .map((row: { id: string }) => row.id);
    for (const id of purchaseIds)
      await ctx.db
        .update(purchases)
        .set({ createdAt: sql`'2026-11-01T10:00:00.123456Z'::timestamptz` })
        .where(eq(purchases.id, id));
    for (const id of offerIds)
      await ctx.db
        .update(offerSnapshots)
        .set({ observedAt: sql`'2026-11-01T10:00:00.123456Z'::timestamptz` })
        .where(eq(offerSnapshots.id, id));
    const all = await client.get('/api/audit?limit=100');
    const ids: string[] = [];
    let path: string | null = '/api/audit?limit=2';
    while (path) {
      const page = await client.get(path);
      expect(page.status).toBe(200);
      ids.push(...page.body.rows.map((row: { id: string }) => row.id));
      path = page.body.nextCursor
        ? `/api/audit?limit=2&cursor=${encodeURIComponent(page.body.nextCursor)}`
        : null;
    }
    expect(ids).toEqual(all.body.rows.map((row: { id: string }) => row.id));
    expect(new Set(ids).size).toBe(6);
    expect(
      (await client.get('/api/audit?state=BLOCKED_AT_CAPTURE&decision=BLOCKED&seeded=true')).body
        .rows,
    ).toHaveLength(1);
    expect((await client.get('/api/audit?seeded=false')).body.rows).toEqual([]);
    expect((await client.get('/api/audit?cursor=invalid')).status).toBe(400);
    expect((await client.get('/api/audit?limit=101')).status).toBe(400);
    expect((await client.get('/api/audit?decision=BOGUS')).status).toBe(400);
    expect((await client.get('/api/audit?seeded=no')).status).toBe(400);
  });

  it('SEC-03 scopes every read and drift operation to the signed session', async () => {
    const { p } = await ready();
    const foreign = sessionClient(ctx.app);
    for (const path of [
      `/api/purchases/${p.id}`,
      `/api/purchases/${p.id}/receipt`,
      `/api/offers/${p.offerSnapshotId}/receipt`,
    ])
      expect((await foreign.get(path)).status).toBe(404);
    expect(
      (await foreign.post(`/api/purchases/${p.id}/simulate-drift`, { kind: 'PRICE_HIKE' })).status,
    ).toBe(404);
    expect((await foreign.get('/api/audit')).body.rows).toEqual([]);
    expect((await foreign.get('/api/audit/verify')).body).toEqual({ status: 'INTACT', checked: 0 });
  });

  it('provides offer-only receipts for blocked decisions', async () => {
    const client = sessionClient(ctx.app);
    await client.post('/api/demo/seed');
    const ledger = await client.get('/api/audit?decision=BLOCKED');
    const offer = ledger.body.rows.find((row: { kind: string }) => row.kind === 'OFFER');
    const receipt = IntentReceiptSchema.parse(
      (await client.get(`/api/offers/${offer.id}/receipt`)).body,
    );
    expect(receipt.purchase).toBeUndefined();
    expect(receipt.offer.decision).toBe('BLOCKED');
    expect(receipt.chain).toBe('INTACT');
  });

  it('SEC-08 rejects UPDATE, DELETE and TRUNCATE; verification detects privileged tampering', async () => {
    const client = sessionClient(ctx.app);
    await client.post('/api/demo/seed');
    const page = await client.get('/api/audit?state=CAPTURED');
    const [purchase] = await ctx.db
      .select()
      .from(purchases)
      .where(eq(purchases.id, page.body.rows[0].id));
    const [victim] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.type, 'DEMO_SEEDED'), eq(auditEvents.sessionId, purchase!.sessionId)),
      );
    if (!victim) throw new Error('Missing seeded audit event');
    await expect(
      ctx.db.update(auditEvents).set({ type: 'CHANGED' }).where(eq(auditEvents.id, victim.id)),
    ).rejects.toThrow();
    await expect(ctx.db.delete(auditEvents).where(eq(auditEvents.id, victim.id))).rejects.toThrow();
    await expect(ctx.db.execute(sql`TRUNCATE audit_events`)).rejects.toThrow();
    const [first] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.sessionId, victim.sessionId))
      .orderBy(auditEvents.seq)
      .limit(1);
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_no_update`);
      await tx
        .update(auditEvents)
        .set({ payload: { tampered: true } })
        .where(eq(auditEvents.id, first!.id));
      await tx.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_no_update`);
    });
    const { AuditRepository } = await import('../../src/repo/auditViews');
    expect(await new AuditRepository(ctx.db).verify(victim.sessionId)).toMatchObject({
      status: 'BROKEN',
      firstBrokenSeq: first!.seq.toString(),
      firstBrokenIndex: 0,
    });
    expect((await client.get('/api/audit/verify')).body.status).toBe('BROKEN');
  });

  it('both demo routes are 404 when controls are disabled', async () => {
    const off = await buildTestApp();
    try {
      const client = sessionClient(off.app);
      expect((await client.post('/api/demo/seed')).status).toBe(404);
      expect(
        (
          await client.post('/api/purchases/00000000-0000-4000-8000-000000000001/simulate-drift', {
            kind: 'PRICE_HIKE',
          })
        ).status,
      ).toBe(404);
      expect(off.fake.calls).toEqual([]);
    } finally {
      await off.close();
    }
  });
});
