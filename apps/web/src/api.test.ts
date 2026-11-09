import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const mandateId = '00000000-0000-4000-8000-000000000001';
const offerId = '00000000-0000-4000-8000-000000000002';
const purchaseId = '00000000-0000-4000-8000-000000000003';
const hash = 'a'.repeat(64);
const mandate = {
  id: mandateId,
  version: 1,
  status: 'DRAFT',
  requestText: 'Buy 1 chair under $120',
  recurringAllowed: false,
  excludedTerms: [],
  clarificationQuestions: [],
  parser: 'rule:v1',
  createdAt: new Date(0).toISOString(),
};
const money = { minor: '8900', currency: 'USD', display: '$89.00' };
const purchase = {
  id: purchaseId,
  mandateId,
  offerSnapshotId: offerId,
  mandateHash: hash,
  state: 'PENDING_APPROVAL',
  quantity: 1,
  itemName: 'Chair',
  unitPrice: money,
  total: money,
  seeded: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const offer = {
  snapshotId: offerId,
  source: 'fixture',
  title: 'Chair',
  recurrenceSignal: 'NONE',
  decision: 'ALLOWED',
  findings: [],
  policyVersion: 'v1',
  observedAt: new Date(0).toISOString(),
  seeded: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('Stage 3 sample checkout client', () => {
  it('creates a pending purchase through mandate/search APIs, without silently approving it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(mandate))
      .mockResolvedValueOnce(Response.json({ ...mandate, status: 'CONFIRMED' }))
      .mockResolvedValueOnce(Response.json({ source: 'fixture', offers: [offer] }))
      .mockResolvedValueOnce(Response.json(purchase));
    vi.stubGlobal('fetch', fetch);
    expect((await api.createTestPurchase()).state).toBe('PENDING_APPROVAL');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/mandates',
      `/api/mandates/${mandateId}/confirm`,
      `/api/mandates/${mandateId}/search`,
      '/api/purchases',
    ]);
    expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({
      mandateId,
      offerSnapshotId: offerId,
    });
  });

  it('requires an allowed search result, rather than inventing a checkout', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(mandate))
      .mockResolvedValueOnce(Response.json({ ...mandate, status: 'CONFIRMED' }))
      .mockResolvedValueOnce(Response.json({ source: 'fixture', offers: [] }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.createTestPurchase()).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('echoes only the approval hash and captures with only the order ID', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(purchase));
    vi.stubGlobal('fetch', fetch);
    await api.approve(purchaseId, hash);
    fetch.mockResolvedValueOnce(Response.json(purchase));
    await api.capture(purchaseId, 'ABCDEFGHIJKLMNOPQ');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ mandateHash: hash });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
      paypalOrderId: 'ABCDEFGHIJKLMNOPQ',
    });
  });
});
