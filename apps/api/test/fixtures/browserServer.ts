import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { buildTestApp } from '../helpers/app';
import { stubGateway } from '../helpers/stubGateway';
import { WEB_DIST_DIR } from '../../src/paths';
import { PayPalOrderIdSchema } from '@intentlock/shared';

// Offline browser harness only: ephemeral PGlite, stub MCP, fake PayPal and mocked Gemini.
const dir = await mkdtemp(path.join(tmpdir(), 'intentlock-browser-'));
const ordersFile = path.join(dir, 'orders.json');
const ctx = await buildTestApp({
  env: { STUDIO_AGENT_ENABLED: 'true', DEMO_CONTROLS_ENABLED: 'true' },
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
    captures: ctx.fake.callsTo('POST', '/capture').length,
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
        await rm(ordersFile, { force: true });
        await rmdir(dir);
      })
      .finally(() => process.exit(0));
  });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
