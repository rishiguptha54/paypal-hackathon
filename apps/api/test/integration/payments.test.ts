import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { PayPalMcpGateway } from '../../src/adapters/paypalMcp/gateway';
import { createLogger } from '../../src/logger';
import { paymentOperations, purchases } from '../../src/repo/schema';
import { buildTestApp } from '../helpers/app';

const STUB = fileURLToPath(new URL('../fixtures/stubMcpServer.mjs', import.meta.url));
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

async function app(opts: Parameters<typeof buildTestApp>[0] = {}) {
  const ctx = await buildTestApp(opts);
  closers.push(ctx.close, () => ctx.gateway.close());
  return ctx;
}

function client(a: Express) {
  let cookie = '';
  const call = async (t: request.Test) => {
    const res = await (cookie ? t.set('Cookie', cookie) : t);
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    if (set?.[0]) cookie = set[0].split(';')[0] as string;
    return res;
  };
  return {
    get: (p: string) => call(request(a).get(p)),
    post: (p: string, body: object = {}) => call(request(a).post(p).send(body)),
  };
}

async function newPurchase(c: ReturnType<typeof client>) {
  const res = await c.post('/api/dev/purchases');
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe('temporary purchase route', () => {
  it('creates a server-priced $1.00 APPROVED purchase', async () => {
    const { app: a } = await app();
    const res = await client(a).post('/api/dev/purchases');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      state: 'APPROVED',
      quantity: 1,
      total: { minor: '100', currency: 'USD', display: '$1.00' },
    });
  });

  it('rejects client-sent amounts', async () => {
    const { app: a } = await app();
    const res = await client(a).post('/api/dev/purchases', { total: '500.00', totalMinor: 50000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNEXPECTED_FIELD');
  });
});

describe('create-order (route 10)', () => {
  it('creates once, stores the order id and is idempotent', async () => {
    const { app: a, db, fake, gateway } = await app();
    const c = client(a);
    const p = await newPurchase(c);
    const first = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    const second = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    expect(first.status).toBe(200);
    expect(first.body.paypalOrderId).toMatch(/^FAKEORDER/);
    expect(second.body).toEqual(first.body);
    expect((gateway as unknown as { createCalls: number }).createCalls).toBe(1);

    const call = fake.callsTo('POST', '/v2/checkout/orders')[0];
    const unit = (
      call?.body as { purchase_units: { amount: { value: string }; custom_id: string }[] }
    ).purchase_units[0];
    expect(unit?.amount.value).toBe('1.00');
    expect(unit?.custom_id).toBe(p.id);

    const ops = await db.select().from(paymentOperations);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      kind: 'CREATE_ORDER',
      status: 'SUCCEEDED',
      channel: 'rest',
      paypalDebugId: 'dbg-fake-1',
    });
    expect(call?.headers['paypal-request-id']).toBe(ops[0]?.paypalRequestId);
    const [row] = await db.select().from(purchases).where(eq(purchases.id, p.id));
    expect(row).toMatchObject({ state: 'ORDER_CREATED', paypalOrderId: first.body.paypalOrderId });
  });

  it('creates only one PayPal order under concurrent requests', async () => {
    const { app: a, gateway } = await app();
    const c = client(a);
    const p = await newPurchase(c);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => c.post(`/api/purchases/${p.id}/paypal/create-order`)),
    );
    expect((gateway as unknown as { createCalls: number }).createCalls).toBe(1);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 409]).toContain(r.status);
  });

  it('returns 404 for another session’s purchase', async () => {
    const { app: a } = await app();
    const owner = client(a);
    const p = await newPurchase(owner);
    const res = await client(a).post(`/api/purchases/${p.id}/paypal/create-order`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('keeps the purchase retryable after an upstream failure and reuses the request id', async () => {
    const ctx = await app();
    const c = client(ctx.app);
    const p = await newPurchase(c);
    let fail = true;
    ctx.fake.intercept = (url, init) =>
      fail && url.endsWith('/v2/checkout/orders') && init?.method === 'POST'
        ? new Response('{}', { status: 500 })
        : undefined;
    const bad = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    expect(bad.status).toBe(502);
    expect(bad.body.error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      details: [{ provider: 'paypal' }],
    });
    fail = false;
    const ok = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    expect(ok.status).toBe(200);
    const ids = ctx.fake
      .callsTo('POST', '/v2/checkout/orders')
      .map((x) => x.headers['paypal-request-id']);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('capture (route 11)', () => {
  async function ready(ctx: Awaited<ReturnType<typeof app>>) {
    const c = client(ctx.app);
    const p = await newPurchase(c);
    const { body } = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    ctx.fake.approve(body.paypalOrderId);
    return { c, id: p.id, orderId: body.paypalOrderId as string };
  }

  it('captures an approved order and stores the verified PayPal status', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    const res = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'CAPTURED',
      paypalStatus: 'COMPLETED',
      paypalOrderId: orderId,
      paypalCaptureId: `CAP${orderId}`,
    });
    const ops = await ctx.db.select().from(paymentOperations);
    const cap = ops.find((o) => o.kind === 'CAPTURE');
    expect(cap).toMatchObject({
      channel: 'rest',
      status: 'SUCCEEDED',
      paypalDebugId: 'dbg-fake-1',
    });
    expect(ctx.fake.callsTo('POST', '/capture')[0]?.headers['paypal-request-id']).toBe(
      cap?.paypalRequestId,
    );
  });

  it('is idempotent once captured and never captures twice', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    const again = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(again.status).toBe(200);
    expect(again.body.state).toBe('CAPTURED');
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(1);
  });

  it('captures at most once under concurrent requests', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    const rs = await Promise.all(
      Array.from({ length: 4 }, () =>
        c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId }),
      ),
    );
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(1);
    expect(rs.some((r) => r.status === 200)).toBe(true);
  });

  it('blocks a different order id', async () => {
    const ctx = await app();
    const { c, id } = await ready(ctx);
    const res = await c.post(`/api/purchases/${id}/paypal/capture`, {
      paypalOrderId: 'ZZZZZZZZZZZZZZZZZ',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPTURE_BLOCKED');
    expect(res.body.error.details).toContainEqual({ code: 'ORDER_ID_MISMATCH' });
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(0);
  });

  it('blocks when the live PayPal amount drifted from the stored total', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    ctx.fake.liveAmountOverride = '2.00';
    const res = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toContainEqual({ code: 'DRIFT_AMOUNT_MISMATCH' });
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(0);
    const [row] = await ctx.db.select().from(purchases).where(eq(purchases.id, id));
    expect(row?.state).toBe('BLOCKED_AT_CAPTURE');
  });

  it('blocks an order the buyer has not approved', async () => {
    const ctx = await app();
    const c = client(ctx.app);
    const p = await newPurchase(c);
    const { body } = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    const res = await c.post(`/api/purchases/${p.id}/paypal/capture`, {
      paypalOrderId: body.paypalOrderId,
    });
    expect(res.body.error.details).toContainEqual({ code: 'ORDER_NOT_APPROVED' });
  });

  it('fails closed with 502 when the live order cannot be read', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    ctx.fake.intercept = (url, init) =>
      url.includes('/v2/checkout/orders/') && (init?.method ?? 'GET') === 'GET'
        ? new Response('{}', { status: 503 })
        : undefined;
    const res = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(res.status).toBe(502);
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(0);
    const [row] = await ctx.db.select().from(purchases).where(eq(purchases.id, id));
    expect(row?.state).toBe('ORDER_CREATED');
  });

  it('keeps ORDER_CREATED on INSTRUMENT_DECLINED and retries with the same request id', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    ctx.fake.captureMode = 'DECLINE';
    const declined = await c.post(`/api/purchases/${id}/paypal/capture`, {
      paypalOrderId: orderId,
    });
    expect(declined.status).toBe(409);
    expect(declined.body.error.code).toBe('INSTRUMENT_DECLINED');
    ctx.fake.captureMode = 'COMPLETED';
    const ok = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(ok.status).toBe(200);
    const ids = ctx.fake.callsTo('POST', '/capture').map((x) => x.headers['paypal-request-id']);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('leaves CAPTURING (outcome unknown) on timeout and never re-captures blindly', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    ctx.fake.captureMode = 'TIMEOUT';
    const res = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
    const [row] = await ctx.db.select().from(purchases).where(eq(purchases.id, id));
    expect(row?.state).toBe('CAPTURING');
    ctx.fake.captureMode = 'COMPLETED';
    const retry = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(retry.status).toBe(409);
    expect(ctx.fake.callsTo('POST', '/capture')).toHaveLength(1);
  });

  it('maps a PENDING capture to CAPTURE_PENDING', async () => {
    const ctx = await app();
    const { c, id, orderId } = await ready(ctx);
    ctx.fake.captureMode = 'PENDING';
    const res = await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: orderId });
    expect(res.body.state).toBe('CAPTURE_PENDING');
  });

  it('rejects a malformed order id and extra fields', async () => {
    const ctx = await app();
    const { c, id } = await ready(ctx);
    expect(
      (await c.post(`/api/purchases/${id}/paypal/capture`, { paypalOrderId: 'bad' })).status,
    ).toBe(400);
    const extra = await c.post(`/api/purchases/${id}/paypal/capture`, {
      paypalOrderId: 'ABCDEFGHIJKLMNOPQ',
      amount: '0.01',
    });
    expect(extra.body.error.code).toBe('UNEXPECTED_FIELD');
  });
});

describe('end to end with the real gateway and the stub MCP server (G0 shape)', () => {
  it('MCP create_order -> approve -> MCP get_order -> REST capture -> CAPTURED', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'il-e2e-'));
    const ctx = await app({
      gateway: (rest) =>
        new PayPalMcpGateway({
          rest,
          launch: { command: process.execPath, args: [STUB] },
          logger: createLogger({ level: 'silent' }),
          extraEnv: { STUB_LOG: path.join(dir, 'log') },
        }),
    });
    await (ctx.gateway as PayPalMcpGateway).start();
    const health = await request(ctx.app).get('/api/health');
    expect(health.body).toEqual({
      status: 'ok',
      checks: { db: 'ok', paypal: 'ok', paypalMcp: 'ok' },
    });

    const c = client(ctx.app);
    const p = await newPurchase(c);
    const created = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    expect(created.status).toBe(200);
    expect(created.body.paypalOrderId).toMatch(/^STUBORDER/);
    expect(ctx.fake.callsTo('POST', '/v2/checkout/orders')).toHaveLength(0);

    // The stub's created order is registered with PayPal's fake so REST capture can find it.
    ctx.fake.orders.set(created.body.paypalOrderId, { total: '1.00', status: 'APPROVED' });
    const cap = await c.post(`/api/purchases/${p.id}/paypal/capture`, {
      paypalOrderId: created.body.paypalOrderId,
    });
    expect(cap.status).toBe(200);
    expect(cap.body).toMatchObject({ state: 'CAPTURED', paypalStatus: 'COMPLETED' });
    expect(ctx.fake.callsTo('GET', '/v2/checkout/orders/')).toHaveLength(0);

    const ops = await ctx.db.select().from(paymentOperations);
    expect(ops.find((o) => o.kind === 'CREATE_ORDER')).toMatchObject({
      channel: 'mcp',
      mcpTool: 'create_order',
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
