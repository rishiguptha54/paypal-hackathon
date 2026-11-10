import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { buildTestApp } from '../helpers/app';
import { stubGateway } from '../helpers/stubGateway';
import { WEB_DIST_DIR } from '../../src/paths';
import { PayPalOrderIdSchema } from '@intentlock/shared';

// Offline browser harness only: ephemeral PGlite, stub MCP, fake PayPal and mocked Gemini.
const dir = await mkdtemp(path.join(tmpdir(), 'intentlock-browser-'));
const ordersFile = path.join(dir, 'orders.json');
let orderSequence = 0;
const captureCalls: string[] = [];
const paypalMsw = setupServer(
  http.post('https://api-m.sandbox.paypal.com/v1/oauth2/token', () => {
    if (fakePaypal) fakePaypal.tokenCalls++;
    return HttpResponse.json({
      access_token: 'msw-sandbox-token',
      token_type: 'Bearer',
      expires_in: 32400,
    });
  }),
  http.post('https://api-m.sandbox.paypal.com/v2/checkout/orders', async ({ request }) => {
    const body = (await request.json()) as {
      purchase_units: { amount: { value: string }; custom_id?: string; invoice_id?: string }[];
    };
    const id = `MSWORDER${String(++orderSequence).padStart(8, '0')}`;
    const unit = body.purchase_units[0]!;
    fakePaypal?.orders.set(id, {
      total: unit.amount.value,
      status: 'CREATED',
      customId: unit.custom_id,
      invoiceId: unit.invoice_id,
    });
    return HttpResponse.json(
      { id, status: 'CREATED', links: [] },
      { status: 201, headers: { 'paypal-debug-id': 'dbg-msw' } },
    );
  }),
  http.get('https://api-m.sandbox.paypal.com/v2/checkout/orders/:id', ({ params }) => {
    const order = fakePaypal?.orders.get(String(params.id));
    if (!order) return HttpResponse.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    return HttpResponse.json(
      {
        id: params.id,
        status: order.status,
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: order.customId,
            invoice_id: order.invoiceId,
            amount: { currency_code: 'USD', value: order.total },
          },
        ],
      },
      { headers: { 'paypal-debug-id': 'dbg-msw' } },
    );
  }),
  http.patch(
    'https://api-m.sandbox.paypal.com/v2/checkout/orders/:id',
    async ({ params, request }) => {
      const order = fakePaypal?.orders.get(String(params.id));
      if (!order) return HttpResponse.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
      const patches = (await request.json()) as { path: string; value: string }[];
      for (const patch of patches) {
        if (patch.path.endsWith('/custom_id')) order.customId = patch.value;
        if (patch.path.endsWith('/invoice_id')) order.invoiceId = patch.value;
      }
      fakePaypal?.onOrderChange?.();
      return new HttpResponse(null, { status: 204 });
    },
  ),
  http.post('https://api-m.sandbox.paypal.com/v2/checkout/orders/:id/capture', ({ params }) => {
    captureCalls.push(String(params.id));
    const order = fakePaypal?.orders.get(String(params.id));
    if (!order) return HttpResponse.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    if (fakePaypal?.captureMode === 'ERROR_500')
      return HttpResponse.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    if (fakePaypal?.captureMode === 'DECLINE')
      return HttpResponse.json(
        { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] },
        { status: 422 },
      );
    const status = fakePaypal?.captureMode === 'PENDING' ? 'PENDING' : 'COMPLETED';
    order.status = status === 'COMPLETED' ? status : 'APPROVED';
    order.captures = [
      { id: `CAP${params.id}`, status, amount: { currency_code: 'USD', value: order.total } },
    ];
    return HttpResponse.json(
      {
        id: params.id,
        status,
        purchase_units: [{ payments: { captures: [{ id: `CAP${params.id}`, status }] } }],
      },
      { status: 201, headers: { 'paypal-debug-id': 'dbg-msw' } },
    );
  }),
);
paypalMsw.listen({ onUnhandledFrame: 'error' });
const ctx = await buildTestApp({
  env: { STUDIO_AGENT_ENABLED: 'true', DEMO_CONTROLS_ENABLED: 'true' },
  paypalFetch: () => fetch,
  webDistDir: WEB_DIST_DIR,
  gateway: (rest, fake) => stubGateway(rest, fake, ordersFile),
  studioGenerator: async (input) => {
    const called = input.messages.flatMap((m) => m.toolCalls ?? []);
    if (called.some((call) => call.function.name === 'add_widget'))
      return {
        text: 'Added a governance widget using only this session dataset. Sample rows are not real payments.',
        calls: [],
      };
    if (called.some((call) => call.function.name === 'delegate_to'))
      return { text: 'The requested dashboard edit is complete.', calls: [] };
    if (input.tools.some((tool) => tool.name === 'delegate_to'))
      return {
        calls: [
          {
            name: 'delegate_to',
            args: {
              type: {
                id: 'page',
                pageId: 'governance',
              },
              instructions: 'Add a widget showing sample capture blocks by reason.',
            },
          },
        ],
      };
    if (input.tools.some((t) => t.name === 'add_widget'))
      return {
        calls: [
          {
            name: 'add_widget',
            args: {
              widgetId: `governance-${Date.now()}`,
              type: 'bar-chart-grouped',
              xTrack: 0,
              yTrack: 48,
              xSpan: 12,
              ySpan: 16,
            },
          },
        ],
      };
    return {
      text: 'Governance Analyst can edit dashboard widgets only. Payment tools are unavailable.',
      calls: [],
    };
  },
});
const fakePaypal = ctx.fake;
if ('start' in ctx.gateway && typeof ctx.gateway.start === 'function') await ctx.gateway.start();
const app = express();
app.post('/__test/paypal/approve', express.json(), (req, res) => {
  const { orderId } = z.strictObject({ orderId: PayPalOrderIdSchema }).parse(req.body);
  ctx.fake.approve(orderId);
  res.json({ approved: true });
});
app.post('/__test/paypal/mode', express.json(), (req, res) => {
  const { mode } = z
    .strictObject({ mode: z.enum(['COMPLETED', 'PENDING', 'DECLINE', 'TIMEOUT', 'ERROR_500']) })
    .parse(req.body);
  ctx.fake.captureMode = mode;
  res.json({ mode });
});
app.get('/__test/stats', (_req, res) =>
  res.json({
    captures: captureCalls.length,
    orders: ctx.fake.orders.size,
  }),
);
app.use(ctx.app);
const server = app.listen(3100, '127.0.0.1', () =>
  process.stdout.write(
    'OFFLINE TEST HARNESS: http://127.0.0.1:3100 (no real PayPal/Gemini calls)\n',
  ),
);
const shutdown = () =>
  server.close(() => {
    void ctx.gateway
      .close()
      .then(ctx.close)
      .then(async () => {
        paypalMsw.close();
        await rm(ordersFile, { force: true });
        await rmdir(dir);
      })
      .finally(() => process.exit(0));
  });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
