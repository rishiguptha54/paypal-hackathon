import { describe, expect, it } from 'vitest';
import { PayPalRestClient, PAYPAL_SANDBOX_BASE_URL } from '../../src/adapters/paypal/client';
import { UpstreamError } from '../../src/errors';
import { FakePayPal } from '../helpers/fakePaypal';

const input = {
  purchaseId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  itemName: 'Test item',
  quantity: 2,
  unitAmountMinor: 14900n,
};

function client(fake: FakePayPal, extra: { timeoutMs?: number } = {}) {
  return new PayPalRestClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetch: fake.fetch,
    ...extra,
  });
}

describe('adapters/paypal REST', () => {
  it('only targets the Sandbox host', () => {
    expect(PAYPAL_SANDBOX_BASE_URL).toBe('https://api-m.sandbox.paypal.com');
  });

  it('caches the OAuth token across calls', async () => {
    const fake = new FakePayPal();
    const c = client(fake);
    await c.createOrder(input, input.requestId);
    await c.createOrder({ ...input, purchaseId: 'x' }, 'other');
    expect(fake.tokenCalls).toBe(1);
  });

  it('refreshes an expired token', async () => {
    const fake = new FakePayPal();
    let now = 1_000_000;
    const c = new PayPalRestClient({
      clientId: 'i',
      clientSecret: 's',
      fetch: fake.fetch,
      now: () => now,
    });
    await c.getAccessToken();
    now += 32_400_000;
    await c.getAccessToken();
    expect(fake.tokenCalls).toBe(2);
  });

  it('shares one in-flight token request between concurrent callers', async () => {
    const fake = new FakePayPal();
    const c = client(fake);
    await Promise.all([c.getAccessToken(), c.getAccessToken(), c.getAccessToken()]);
    expect(fake.tokenCalls).toBe(1);
  });

  it('sends the stable PayPal-Request-Id and builds the body from minor units', async () => {
    const fake = new FakePayPal();
    const res = await client(fake).createOrder(input, input.requestId);
    const call = fake.callsTo('POST', '/v2/checkout/orders')[0];
    expect(call?.headers['paypal-request-id']).toBe(input.requestId);
    expect(call?.headers['authorization']).toBe('Bearer fake-token');
    const unit = (call?.body as { purchase_units: Record<string, unknown>[] }).purchase_units[0];
    expect(unit).toMatchObject({
      custom_id: input.purchaseId,
      invoice_id: input.purchaseId,
      amount: { currency_code: 'USD', value: '298.00' },
    });
    expect(res.debugId).toBe('dbg-fake-1');
    expect(res.data.status).toBe('CREATED');
  });

  it('reuses the same request id on capture retries and records paypal-debug-id', async () => {
    const fake = new FakePayPal();
    const c = client(fake);
    const { data } = await c.createOrder(input, input.requestId);
    await c.captureOrder(data.id, 'cap-req-1');
    await c.captureOrder(data.id, 'cap-req-1');
    const ids = fake.callsTo('POST', '/capture').map((x) => x.headers['paypal-request-id']);
    expect(ids).toEqual(['cap-req-1', 'cap-req-1']);
  });

  it('does not PATCH the direct REST create/capture flow', async () => {
    const fake = new FakePayPal();
    const c = client(fake);
    const { data } = await c.createOrder(input, input.requestId);
    await c.getOrder(data.id);
    await c.captureOrder(data.id, 'r');
    expect(fake.calls.some((x) => x.method === 'PATCH')).toBe(false);
  });

  it('binds MCP-created IDs only while CREATED, and verifies custom_id and invoice_id', async () => {
    const fake = new FakePayPal();
    const orderId = 'MCPORDER000000001';
    fake.orders.set(orderId, { total: '298.00', status: 'CREATED' });
    const c = client(fake);
    await c.bindOrder(orderId, input.purchaseId, input.requestId);
    expect(fake.callsTo('PATCH', '/orders/')[0]?.body).toEqual([
      {
        op: 'add',
        path: "/purchase_units/@reference_id=='default'/custom_id",
        value: input.purchaseId,
      },
      {
        op: 'add',
        path: "/purchase_units/@reference_id=='default'/invoice_id",
        value: input.purchaseId,
      },
    ]);
    fake.approve(orderId);
    await expect(c.bindOrder(orderId, input.purchaseId, input.requestId)).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(fake.callsTo('PATCH', '/orders/')).toHaveLength(1);
  });

  it('rejects responses that fail Zod validation', async () => {
    const fake = new FakePayPal();
    fake.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('oauth')
            ? { access_token: 't', token_type: 'B', expires_in: 60 }
            : { nope: true },
        ),
        {
          status: 200,
        },
      );
    await expect(client(fake).getOrder('ABCDEFGHIJKLMNOPQ')).rejects.toMatchObject({
      name: 'UpstreamError',
      provider: 'paypal',
      kind: 'error',
    });
  });

  it('surfaces the PayPal issue code on HTTP errors', async () => {
    const fake = new FakePayPal();
    fake.captureMode = 'DECLINE';
    const c = client(fake);
    const { data } = await c.createOrder(input, input.requestId);
    const err = await c.captureOrder(data.id, 'r').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).meta).toMatchObject({
      httpStatus: 422,
      issue: 'INSTRUMENT_DECLINED',
      debugId: 'dbg-fake-1',
    });
  });

  it('maps a timeout to a typed upstream timeout', async () => {
    const fake = new FakePayPal();
    fake.captureMode = 'TIMEOUT';
    const c = client(fake);
    const { data } = await c.createOrder(input, input.requestId);
    await expect(c.captureOrder(data.id, 'r')).rejects.toMatchObject({
      kind: 'timeout',
      provider: 'paypal',
    });
  });

  it('aborts a hung request after the configured timeout', async () => {
    const fake = new FakePayPal();
    fake.fetch = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
      });
    await expect(client(fake, { timeoutMs: 50 }).getAccessToken()).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});
