import {
  CreateOrderResponseSchema,
  ErrorEnvelopeSchema,
  PublicConfigSchema,
  PurchaseSchema,
  MandateSchema,
  EvaluatedOfferSchema,
  OfferSourceSchema,
  MandateFieldsSchema,
  LedgerPageSchema,
  IntentReceiptSchema,
  AuditVerificationSchema,
  AnalyticsDatasetSchema,
  type DriftKind,
  type MandateFields,
  type CreateOrderResponse,
  type PublicConfig,
  type Purchase,
} from '@intentlock/shared';
import { z, type ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, schema: ZodType<T>, body?: object) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const env = ErrorEnvelopeSchema.safeParse(json);
    throw env.success
      ? new ApiError(
          res.status,
          env.data.error.code,
          env.data.error.message,
          env.data.error.requestId,
        )
      : new ApiError(res.status, 'UNKNOWN', 'Unexpected server response.');
  }
  return schema.parse(json);
}

// Budgets are mandate inputs; checkout prices and totals are always server-computed.
export const api = {
  config: (): Promise<PublicConfig> => request('GET', '/config', PublicConfigSchema),
  draft: (requestText: string) => request('POST', '/mandates', MandateSchema, { requestText }),
  confirm: (id: string, fields: MandateFields) =>
    request('POST', `/mandates/${id}/confirm`, MandateSchema, MandateFieldsSchema.parse(fields)),
  search: (id: string) =>
    request(
      'POST',
      `/mandates/${id}/search`,
      z.object({ source: OfferSourceSchema, offers: z.array(EvaluatedOfferSchema) }),
    ),
  select: (mandateId: string, offerSnapshotId: string) =>
    request('POST', '/purchases', PurchaseSchema, { mandateId, offerSnapshotId }),
  ledger: (cursor?: string) =>
    request(
      'GET',
      `/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      LedgerPageSchema,
    ),
  receipt: (kind: 'PURCHASE' | 'OFFER', id: string) =>
    request(
      'GET',
      `/${kind === 'PURCHASE' ? 'purchases' : 'offers'}/${id}/receipt`,
      IntentReceiptSchema,
    ),
  verify: () => request('GET', '/audit/verify', AuditVerificationSchema),
  dataset: () => request('GET', '/analytics/dataset?days=90', AnalyticsDatasetSchema),
  seed: () =>
    request(
      'POST',
      '/demo/seed',
      z.object({
        seeded: z.object({ mandates: z.number(), evaluations: z.number(), purchases: z.number() }),
      }),
    ),
  drift: (id: string, kind: DriftKind) =>
    request('POST', `/purchases/${id}/simulate-drift`, PurchaseSchema, { kind }),
  tamper: (id: string) =>
    request('POST', `/purchases/${id}/approve`, PurchaseSchema, { total: '1.00' }),
  createTestPurchase: async (): Promise<Purchase> => {
    const fields = {
      productQuery: 'ergonomic desk chair',
      quantity: 1,
      maxTotal: '120.00',
      currency: 'USD',
      allowedMerchantDomains: ['northstar-office.example'],
      recurringAllowed: false,
      excludedTerms: [],
    };
    const draft = await request('POST', '/mandates', MandateSchema, {
      requestText: 'Buy 1 ergonomic desk chair under $120 from northstar-office.example',
    });
    const mandate = await request('POST', `/mandates/${draft.id}/confirm`, MandateSchema, fields);
    const search = await request(
      'POST',
      `/mandates/${mandate.id}/search`,
      z.object({
        source: OfferSourceSchema,
        offers: z.array(EvaluatedOfferSchema),
      }),
    );
    const offer = search.offers.find((item) => item.decision === 'ALLOWED');
    if (!offer)
      throw new ApiError(409, 'POLICY_BLOCKED', 'No allowed offer matches the sample mandate.');
    return request('POST', '/purchases', PurchaseSchema, {
      mandateId: mandate.id,
      offerSnapshotId: offer.snapshotId,
    });
  },
  approve: (purchaseId: string, mandateHash: string): Promise<Purchase> =>
    request('POST', `/purchases/${purchaseId}/approve`, PurchaseSchema, { mandateHash }),
  cancel: (purchaseId: string): Promise<Purchase> =>
    request('POST', `/purchases/${purchaseId}/cancel`, PurchaseSchema),
  purchase: (purchaseId: string): Promise<Purchase> =>
    request('GET', `/purchases/${purchaseId}`, PurchaseSchema),
  createOrder: (purchaseId: string): Promise<CreateOrderResponse> =>
    request('POST', `/purchases/${purchaseId}/paypal/create-order`, CreateOrderResponseSchema),
  capture: (purchaseId: string, paypalOrderId: string): Promise<Purchase> =>
    request('POST', `/purchases/${purchaseId}/paypal/capture`, PurchaseSchema, { paypalOrderId }),
};
