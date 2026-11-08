import { z } from 'zod';

export const CurrencySchema = z.literal('USD');

/** Money crosses the wire as a string of integer minor units (never a JS number). */
export const MoneySchema = z.strictObject({
  minor: z.string().regex(/^\d{1,18}$/),
  currency: CurrencySchema,
  display: z.string(),
});
export type Money = z.infer<typeof MoneySchema>;

export const PURCHASE_STATES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'ORDER_CREATED',
  'CAPTURING',
  'CAPTURED',
  'CAPTURE_PENDING',
  'CAPTURE_FAILED',
  'BLOCKED_AT_CAPTURE',
  'CANCELLED',
  'EXPIRED',
  'REVERSED',
] as const;
export const PurchaseStateSchema = z.enum(PURCHASE_STATES);
export type PurchaseState = z.infer<typeof PurchaseStateSchema>;

export const PayPalOrderIdSchema = z.string().regex(/^[A-Z0-9]{17,32}$/, 'Invalid PayPal order id');

/** Stage 1 subset of the Purchase contract (spec/contracts/api.md section 4). */
export const PurchaseSchema = z.object({
  id: z.uuid(),
  state: PurchaseStateSchema,
  quantity: z.number().int().positive(),
  itemName: z.string(),
  unitPrice: MoneySchema,
  total: MoneySchema,
  approvedAt: z.string().optional(),
  approvalExpiresAt: z.string().optional(),
  paypalOrderId: z.string().optional(),
  paypalCaptureId: z.string().optional(),
  paypalStatus: z.string().optional(),
  blockReasons: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const CreateOrderRequestSchema = z.strictObject({});
export const CreateOrderResponseSchema = z.object({ paypalOrderId: PayPalOrderIdSchema });
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>;

export const CaptureRequestSchema = z.strictObject({ paypalOrderId: PayPalOrderIdSchema });
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const CheckStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const HealthResponseSchema = z.object({
  status: CheckStatusSchema,
  checks: z.object({
    db: CheckStatusSchema,
    paypal: CheckStatusSchema,
    paypalMcp: CheckStatusSchema,
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Public values only: nothing here may be a secret. */
export const PublicConfigSchema = z.object({
  paypalClientId: z.string(),
  productSource: z.enum(['channel3', 'fixture']),
  aiProvider: z.enum(['openai', 'rule']),
  environment: z.literal('sandbox'),
  demoControlsEnabled: z.boolean(),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
