import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { buildTestApp } from '../helpers/app';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

function sessionClient(app: Express) {
  let cookie = '';
  const capture = (res: request.Response) => {
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    if (setCookie?.[0]) cookie = setCookie[0].split(';')[0] as string;
    return res;
  };
  const withSession = (test: request.Test) => (cookie ? test.set('Cookie', cookie) : test);
  return {
    post: async (path: string, body: unknown) =>
      capture(
        await withSession(
          request(app)
            .post(path)
            .send(body as object),
        ),
      ),
    get: async (path: string) => capture(await withSession(request(app).get(path))),
  };
}

describe('Stage 2 fixture API flow', () => {
  const confirmedFields = {
    productQuery: 'ergonomic desk chair',
    quantity: 1,
    maxTotal: '120.00',
    currency: 'USD',
    allowedMerchantDomains: ['northstar-office.example'],
    recurringAllowed: false,
    excludedTerms: [],
  };

  it('creates, confirms, evaluates, purchases, approves, reads, and cancels within one session', async () => {
    const client = sessionClient(ctx.app);
    const created = await client.post('/api/mandates', {
      requestText: 'Buy 1 ergonomic desk chair for max $120 from northstar-office.example',
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');

    const confirmed = await client.post(`/api/mandates/${created.body.id}/confirm`, {
      productQuery: 'ergonomic desk chair',
      quantity: 1,
      maxTotal: '120.00',
      currency: 'USD',
      allowedMerchantDomains: ['northstar-office.example'],
      recurringAllowed: false,
      excludedTerms: [],
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');

    const searched = await client.post(`/api/mandates/${created.body.id}/search`, {});
    expect(searched.status).toBe(200);
    expect(searched.body.source).toBe('fixture');
    const allowed = searched.body.offers.find(
      (offer: { decision: string }) => offer.decision === 'ALLOWED',
    );
    expect(allowed).toBeDefined();

    const purchase = await client.post('/api/purchases', {
      mandateId: created.body.id,
      offerSnapshotId: allowed.snapshotId,
    });
    expect(purchase.status).toBe(201);
    expect(purchase.body.state).toBe('PENDING_APPROVAL');
    expect(purchase.body.total.minor).toBe('8900');

    const rejectedApproval = await client.post(`/api/purchases/${purchase.body.id}/approve`, {
      mandateHash: '0'.repeat(64),
    });
    expect(rejectedApproval.status).toBe(409);
    expect(rejectedApproval.body.error.code).toBe('MANDATE_HASH_MISMATCH');

    const approved = await client.post(`/api/purchases/${purchase.body.id}/approve`, {
      mandateHash: purchase.body.mandateHash,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe('APPROVED');
    expect(Date.parse(approved.body.approvalExpiresAt)).toBeGreaterThan(Date.now());

    const fetched = await client.get(`/api/purchases/${purchase.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.mandateHash).toBe(purchase.body.mandateHash);

    const cancelled = await client.post(`/api/purchases/${purchase.body.id}/cancel`, {});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe('CANCELLED');
  });

  it('rejects unexpected request fields and isolates resources by session', async () => {
    const first = sessionClient(ctx.app);
    const invalid = await first.post('/api/mandates', {
      requestText: 'Buy 1 chair for max $40 from example.com',
      quantity: 1,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('UNEXPECTED_FIELD');

    const created = await first.post('/api/mandates', {
      requestText: 'Buy 1 chair for max $40 from example.com',
    });
    const second = sessionClient(ctx.app);
    const foreign = await second.get(`/api/mandates/${created.body.id}`);
    expect(foreign.status).toBe(404);
  });

  it('creates a new mandate version and cancels pending purchases from the superseded version', async () => {
    const client = sessionClient(ctx.app);
    const created = await client.post('/api/mandates', {
      requestText: 'Buy 1 ergonomic desk chair for max $120 from northstar-office.example',
    });
    const confirmed = await client.post(
      `/api/mandates/${created.body.id}/confirm`,
      confirmedFields,
    );
    const searched = await client.post(`/api/mandates/${confirmed.body.id}/search`, {});
    const allowed = searched.body.offers.find(
      (offer: { decision: string }) => offer.decision === 'ALLOWED',
    );
    const purchase = await client.post('/api/purchases', {
      mandateId: confirmed.body.id,
      offerSnapshotId: allowed.snapshotId,
    });

    const revised = await client.post(`/api/mandates/${confirmed.body.id}/confirm`, {
      ...confirmedFields,
      maxTotal: '130.00',
    });
    expect(revised.status).toBe(200);
    expect(revised.body.id).not.toBe(confirmed.body.id);
    expect(revised.body.version).toBe(2);
    expect((await client.get(`/api/mandates/${confirmed.body.id}`)).body.status).toBe('SUPERSEDED');
    expect((await client.get(`/api/purchases/${purchase.body.id}`)).body.state).toBe('CANCELLED');
  });

  it('re-evaluates and rejects a blocked offer at purchase creation', async () => {
    const client = sessionClient(ctx.app);
    const created = await client.post('/api/mandates', {
      requestText: 'Buy 1 ergonomic desk chair for max $50 from northstar-office.example',
    });
    const confirmed = await client.post(`/api/mandates/${created.body.id}/confirm`, {
      ...confirmedFields,
      maxTotal: '50.00',
    });
    const searched = await client.post(`/api/mandates/${confirmed.body.id}/search`, {});
    const blocked = searched.body.offers.find(
      (offer: { decision: string }) => offer.decision === 'BLOCKED',
    );
    const result = await client.post('/api/purchases', {
      mandateId: confirmed.body.id,
      offerSnapshotId: blocked.snapshotId,
    });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('POLICY_BLOCKED');
    expect(result.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OVER_BUDGET' })]),
    );
  });
});
