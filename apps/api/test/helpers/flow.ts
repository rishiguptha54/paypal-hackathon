import { expect } from 'vitest';
import type request from 'supertest';
import { PurchaseSchema, type Purchase } from '@intentlock/shared';

export interface ApiClient {
  post(path: string, body?: object): Promise<request.Response>;
}

export async function pendingPurchase(client: ApiClient): Promise<Purchase> {
  const draft = await client.post('/api/mandates', {
    requestText: 'Buy 1 chair under $120 from northstar-office.example',
  });
  expect(draft.status).toBe(201);
  const mandate = await client.post(`/api/mandates/${draft.body.id}/confirm`, {
    productQuery: 'chair',
    quantity: 1,
    maxTotal: '120.00',
    currency: 'USD',
    allowedMerchantDomains: ['northstar-office.example'],
    recurringAllowed: false,
    excludedTerms: [],
  });
  expect(mandate.status).toBe(200);
  const search = await client.post(`/api/mandates/${mandate.body.id}/search`, {});
  expect(search.status).toBe(200);
  const offer = search.body.offers.find(
    (item: { decision: string }) => item.decision === 'ALLOWED',
  );
  const created = await client.post('/api/purchases', {
    mandateId: mandate.body.id,
    offerSnapshotId: offer.snapshotId,
  });
  expect(created.status).toBe(201);
  return PurchaseSchema.parse(created.body);
}

export async function approvedPurchase(client: ApiClient): Promise<Purchase> {
  const created = await pendingPurchase(client);
  const approved = await client.post(`/api/purchases/${created.id}/approve`, {
    mandateHash: created.mandateHash,
  });
  expect(approved.status).toBe(200);
  return PurchaseSchema.parse(approved.body);
}
