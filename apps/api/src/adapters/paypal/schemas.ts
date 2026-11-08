import { z } from 'zod';

const AmountSchema = z.object({ currency_code: z.string(), value: z.string() });

/** OAuth2 token response. */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
});

/** Orders v2 create returns only the id + status (+ links) unless a representation is requested. */
export const CreatedOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
});
export type CreatedOrder = z.infer<typeof CreatedOrderSchema>;

/** Orders v2 GET: the live order that the capture gate compares against stored values. */
export const PayPalOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  intent: z.string().optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        invoice_id: z.string().optional(),
        amount: AmountSchema,
        payee: z.object({ merchant_id: z.string().optional() }).optional(),
      }),
    )
    .min(1),
});
export type PayPalOrder = z.infer<typeof PayPalOrderSchema>;

const CaptureSchema = z.object({ id: z.string().min(1), status: z.string().min(1) });

export const CaptureResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  purchase_units: z
    .array(z.object({ payments: z.object({ captures: z.array(CaptureSchema).min(1) }) }))
    .min(1),
});
export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;

export const PayPalErrorBodySchema = z.object({
  name: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});

/** Server-side values only; built from the stored purchase, never from client input. */
export interface CreateOrderInput {
  purchaseId: string;
  /** Stable per (purchase, CREATE_ORDER); sent as PayPal-Request-Id on the REST path. */
  requestId: string;
  itemName: string;
  quantity: number;
  unitAmountMinor: bigint;
}

export interface RestResult<T> {
  data: T;
  httpStatus: number;
  debugId?: string;
}
