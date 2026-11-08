import {
  CreateOrderResponseSchema,
  ErrorEnvelopeSchema,
  PublicConfigSchema,
  PurchaseSchema,
  type CreateOrderResponse,
  type PublicConfig,
  type Purchase,
} from '@intentlock/shared';
import type { ZodType } from 'zod';

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

// The client never sends an amount; the server owns every number.
export const api = {
  config: (): Promise<PublicConfig> => request('GET', '/config', PublicConfigSchema),
  createTestPurchase: (): Promise<Purchase> => request('POST', '/dev/purchases', PurchaseSchema),
  createOrder: (purchaseId: string): Promise<CreateOrderResponse> =>
    request('POST', `/purchases/${purchaseId}/paypal/create-order`, CreateOrderResponseSchema),
  capture: (purchaseId: string, paypalOrderId: string): Promise<Purchase> =>
    request('POST', `/purchases/${purchaseId}/paypal/capture`, PurchaseSchema, { paypalOrderId }),
};
