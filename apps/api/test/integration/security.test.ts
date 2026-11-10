import { Writable } from 'node:stream';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger';
import {
  auditEvents,
  evaluations,
  mandates,
  offerSnapshots,
  paymentOperations,
  purchases,
  sessions,
} from '../../src/repo/schema';
import { buildTestApp } from '../helpers/app';
import { approvedPurchase } from '../helpers/flow';
import { sessionClient } from '../helpers/session';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let logOutput = '';
const sink = new Writable({
  write(chunk, _encoding, done) {
    logOutput += chunk.toString();
    done();
  },
});
beforeAll(async () => {
  ctx = await buildTestApp({ logger: createLogger({ level: 'info', destination: sink }) });
});
afterAll(async () => ctx.close());

describe('Stage 5 security regression tests', () => {
  it('SEC-09: a complete capture flow logs no tokens or buyer details', async () => {
    const client = sessionClient(ctx.app);
    const purchase = await approvedPurchase(client);
    const created = await client.post(`/api/purchases/${purchase.id}/paypal/create-order`);
    expect(created.status).toBe(200);
    ctx.fake.approve(created.body.paypalOrderId);
    const captured = await client.post(`/api/purchases/${purchase.id}/paypal/capture`, {
      paypalOrderId: created.body.paypalOrderId,
    });
    expect(captured.body.state).toBe('CAPTURED');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logOutput).not.toContain('fake-token');
    expect(logOutput).not.toContain('test-client-secret');
    expect(logOutput).not.toContain('sandbox-buyer@example.invalid');
    expect(logOutput).not.toContain('PayerGivenSentinel');
    expect(logOutput).not.toContain('PayerSurnameSentinel');
    expect(logOutput).toContain('paypalDebugId');
  });

  it('SEC-10: payer email and name from PayPal responses are not persisted', async () => {
    const client = sessionClient(ctx.app);
    const purchase = await approvedPurchase(client);
    const created = await client.post(`/api/purchases/${purchase.id}/paypal/create-order`);
    ctx.fake.approve(created.body.paypalOrderId);
    expect(
      (
        await client.post(`/api/purchases/${purchase.id}/paypal/capture`, {
          paypalOrderId: created.body.paypalOrderId,
        })
      ).body.state,
    ).toBe('CAPTURED');
    const persisted = JSON.stringify(
      {
        purchases: await ctx.db.select().from(purchases),
        operations: await ctx.db.select().from(paymentOperations),
        audit: await ctx.db.select().from(auditEvents),
        sessions: await ctx.db.select().from(sessions),
        mandates: await ctx.db.select().from(mandates),
        offers: await ctx.db.select().from(offerSnapshots),
        evaluations: await ctx.db.select().from(evaluations),
      },
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    );
    expect(persisted).not.toContain('sandbox-buyer@example.invalid');
    expect(persisted).not.toContain('PayerGivenSentinel');
    expect(persisted).not.toContain('PayerSurnameSentinel');
  });

  it('SEC-13: arbitrary and Unicode intent text never produces a server error', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'grapheme', maxLength: 1000 }), async (requestText) => {
        const response = await sessionClient(ctx.app).post('/api/mandates', { requestText });
        expect(response.status).toBeLessThan(500);
        expect(response.status).toBeGreaterThanOrEqual(200);
      }),
      { numRuns: 20 },
    );
  }, 60_000);

  it('SEC-13: arbitrary mandate fields never produce a server error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          productQuery: fc.string({ unit: 'grapheme', maxLength: 220 }),
          quantity: fc.integer({ min: -2, max: 110 }),
          maxTotal: fc.string({ maxLength: 30 }),
          domain: fc.string({ unit: 'grapheme', maxLength: 280 }),
          recurringAllowed: fc.boolean(),
          excluded: fc.array(fc.string({ maxLength: 50 }), { maxLength: 3 }),
        }),
        async (value) => {
          const client = sessionClient(ctx.app);
          const draft = await client.post('/api/mandates', {
            requestText: 'Buy one chair for under 100 dollars from northstar-office.example',
          });
          const response = await client.post(`/api/mandates/${draft.body.id}/confirm`, {
            productQuery: value.productQuery,
            quantity: value.quantity,
            maxTotal: value.maxTotal,
            currency: 'USD',
            allowedMerchantDomains: [value.domain],
            recurringAllowed: value.recurringAllowed,
            excludedTerms: value.excluded,
          });
          expect(response.status).toBeLessThan(500);
          expect(response.status).toBeGreaterThanOrEqual(200);
        },
      ),
      { numRuns: 20 },
    );
  }, 60_000);
});
