import { z } from 'zod';
export { REASON_CODE_TEMPLATES } from './reasonCodes';
export type { PolicyFinding, ReasonCode, Severity } from './reasonCodes';

export const CurrencySchema = z.literal('USD');
/** Money crosses the wire as a string of integer minor units (never a JS number). */
export const MoneySchema = z.strictObject({
  minor: z.string().regex(/^\d{1,18}$/),
  currency: CurrencySchema,
  display: z.string(),
});
export type Money = z.infer<typeof MoneySchema>;

export const DomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => !/[/:@?#\\\s]/.test(value), 'must be a hostname')
  .transform((value) => {
    try {
      return new URL(`https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  })
  .refine(
    (value) =>
      value.length <= 253 &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) &&
      value
        .split('.')
        .every((label) => label.length <= 63 && !label.startsWith('-') && !label.endsWith('-')),
    'must be a valid IDNA hostname',
  );

export const MandateFieldsSchema = z.strictObject({
  productQuery: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(100),
  maxTotal: z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/),
  currency: CurrencySchema,
  allowedMerchantDomains: z.array(DomainSchema).min(1).max(20),
  recurringAllowed: z.boolean().default(false),
  excludedTerms: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
});
export type MandateFields = z.infer<typeof MandateFieldsSchema>;

export const ClarificationQuestionSchema = z.strictObject({
  field: z.enum(['productQuery', 'quantity', 'maxTotal', 'currency', 'allowedMerchantDomains']),
  question: z.string().min(1).max(240),
});
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

export const MandateStatusSchema = z.enum([
  'DRAFT',
  'NEEDS_CLARIFICATION',
  'CONFIRMED',
  'SUPERSEDED',
]);
export const CreateMandateRequestSchema = z.strictObject({
  requestText: z.string().trim().min(2).max(1000),
});
export const SearchOffersRequestSchema = z.strictObject({});
export const CreatePurchaseRequestSchema = z.strictObject({
  mandateId: z.uuid(),
  offerSnapshotId: z.uuid(),
});
export const ApprovePurchaseRequestSchema = z.strictObject({
  mandateHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const CancelPurchaseRequestSchema = z.strictObject({});
export const DraftMandateSchema = z.strictObject({
  productQuery: z.string().trim().min(2).max(200).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  maxTotal: z
    .string()
    .regex(/^\d{1,9}(?:\.\d{1,2})?$/)
    .optional(),
  currency: CurrencySchema.optional(),
  allowedMerchantDomains: z.array(DomainSchema).max(20).optional(),
  recurringAllowed: z.boolean().default(false),
  excludedTerms: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  clarificationQuestions: z.array(ClarificationQuestionSchema).max(5),
});
export type DraftMandate = z.infer<typeof DraftMandateSchema>;

export const MandateSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  status: MandateStatusSchema,
  requestText: z.string().max(1000),
  productQuery: z.string().optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  maxTotal: z.string().optional(),
  currency: CurrencySchema.optional(),
  allowedMerchantDomains: z.array(DomainSchema).optional(),
  recurringAllowed: z.boolean(),
  excludedTerms: z.array(z.string()),
  clarificationQuestions: z.array(ClarificationQuestionSchema),
  parser: z.string(),
  createdAt: z.string(),
  confirmedAt: z.string().optional(),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const RecurrenceSignalSchema = z.enum(['NONE', 'RECURRING', 'AMBIGUOUS']);
export const OfferSourceSchema = z.enum(['channel3', 'fixture']);
export const OfferSnapshotSchema = z.object({
  id: z.uuid(),
  source: OfferSourceSchema,
  sourceProductId: z.string(),
  title: z.string().max(300),
  brand: z.string().nullable().optional(),
  merchantName: z.string().nullable().optional(),
  merchantDomain: DomainSchema.nullable().optional(),
  offerUrl: z.url().nullable().optional(),
  unitAmountMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  recurrenceSignal: RecurrenceSignalSchema,
  recurrenceEvidence: z.string().nullable().optional(),
  rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.string(),
});
export type OfferSnapshot = z.infer<typeof OfferSnapshotSchema>;

export const DecisionSchema = z.enum(['ALLOWED', 'BLOCKED', 'NEEDS_REVIEW']);
export const SeveritySchema = z.enum(['BLOCKING', 'REVIEW', 'INFO']);
export const FindingSchema = z.object({
  code: z.string(),
  severity: SeveritySchema,
  message: z.string(),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type Finding = z.infer<typeof FindingSchema>;
export const EvaluationSchema = z.object({
  decision: DecisionSchema,
  findings: z.array(FindingSchema),
  policyVersion: z.string(),
  evaluatedAt: z.string(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;
export const EvaluatedOfferSchema = z.object({
  snapshotId: z.uuid(),
  source: OfferSourceSchema,
  title: z.string(),
  brand: z.string().optional(),
  merchantName: z.string().optional(),
  merchantDomain: z.string().optional(),
  offerUrl: z.string().optional(),
  unitPrice: MoneySchema.optional(),
  totalPrice: MoneySchema.optional(),
  recurrenceSignal: RecurrenceSignalSchema,
  decision: DecisionSchema,
  findings: z.array(FindingSchema),
  policyVersion: z.string(),
  observedAt: z.string(),
  seeded: z.boolean(),
});
export type EvaluatedOffer = z.infer<typeof EvaluatedOfferSchema>;

/** Money crosses the wire as a string of integer minor units (never a JS number). */
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
export const MandateHashFieldsSchema = z.strictObject({
  mandateId: z.uuid(),
  mandateVersion: z.number().int().positive(),
  offerId: z.uuid(),
  merchantDomain: z.string(),
  quantity: z.number().int().min(1).max(100),
  unitPriceMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  recurring: z.boolean(),
});
export type MandateHashFields = z.infer<typeof MandateHashFieldsSchema>;

export const PayPalOrderIdSchema = z.string().regex(/^[A-Z0-9]{17,32}$/, 'Invalid PayPal order id');
export const DriftKindSchema = z.enum(['PRICE_HIKE', 'MERCHANT_SWAP', 'APPROVAL_EXPIRED']);
export type DriftKind = z.infer<typeof DriftKindSchema>;
export const SimulateDriftRequestSchema = z.strictObject({ kind: DriftKindSchema });
export const DemoSeedRequestSchema = z.strictObject({});

/** Stage 1 subset of the Purchase contract (spec/contracts/api.md section 4). */
export const PurchaseSchema = z.object({
  id: z.uuid(),
  mandateId: z.uuid().optional(),
  offerSnapshotId: z.uuid().optional(),
  mandateHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
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
  blockReasons: z.array(FindingSchema).optional(),
  simulatedDrift: DriftKindSchema.optional(),
  seeded: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const AuditQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
  decision: DecisionSchema.optional(),
  state: PurchaseStateSchema.optional(),
  seeded: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export const LedgerRowSchema = z.object({
  id: z.uuid(),
  time: z.string(),
  kind: z.enum(['OFFER', 'PURCHASE', 'REQUEST_REJECTED']),
  product: z.string(),
  merchant: z.string().nullable(),
  source: z.union([OfferSourceSchema, z.literal('none')]),
  decision: DecisionSchema,
  reasonCodes: z.array(z.string()),
  approvalHashStatus: z.enum(['NONE', 'LOCKED', 'VERIFIED', 'MISMATCH']),
  paypalOrderId: z.string().optional(),
  mcpTraceStatus: z.enum(['NONE', 'OK', 'FALLBACK_REST', 'ERROR']),
  state: PurchaseStateSchema.optional(),
  total: MoneySchema.optional(),
  seeded: z.boolean(),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;
export const McpTraceSchema = z.object({
  tool: z.enum(['create_order', 'get_order']),
  status: z.enum(['OK', 'ERROR', 'TIMEOUT']),
  durationMs: z.number().nonnegative(),
  at: z.string(),
  fallbackToRest: z.boolean(),
});
export const AuditVerificationSchema = z.object({
  status: z.enum(['INTACT', 'BROKEN']),
  checked: z.number().int().nonnegative(),
  firstBrokenSeq: z.string().optional(),
  firstBrokenIndex: z.number().int().nonnegative().optional(),
});
export const IntentReceiptSchema = z.object({
  requestText: z.string(),
  mandate: MandateSchema,
  offer: EvaluatedOfferSchema,
  purchase: PurchaseSchema.optional(),
  approval: z
    .object({ mandateHash: z.string(), approvedAt: z.string(), expiresAt: z.string() })
    .optional(),
  mcpTrace: z.array(McpTraceSchema),
  paypal: z
    .object({
      orderId: z.string(),
      captureId: z.string().optional(),
      status: z.string(),
      debugId: z.string().optional(),
    })
    .optional(),
  events: z.array(
    z.object({ seq: z.string(), type: z.string(), createdAt: z.string(), entryHash: z.string() }),
  ),
  chain: z.enum(['INTACT', 'BROKEN']),
  sandboxNotice: z.string(),
  seeded: z.boolean(),
});
export type IntentReceipt = z.infer<typeof IntentReceiptSchema>;

export const AnalyticsQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export const AnalyticsRowSchema = z.object({
  time: z.string(),
  day: z.string(),
  productQuery: z.string(),
  merchantDomain: z.string().optional(),
  source: OfferSourceSchema,
  decision: DecisionSchema,
  primaryReason: z.string(),
  reasonCodes: z.array(z.string()),
  offerTotalMinor: z.string().regex(/^\d+$/).optional(),
  approved: z.boolean(),
  purchaseState: PurchaseStateSchema.optional(),
  capturedTotalMinor: z.string().regex(/^\d+$/).optional(),
  blockedAtCapture: z.boolean(),
  captureBlockCodes: z.array(z.string()),
  mcpTraceStatus: LedgerRowSchema.shape.mcpTraceStatus,
  approvalToCaptureSeconds: z.number().nonnegative().optional(),
  policyVersion: z.string(),
  seeded: z.boolean(),
});
export type AnalyticsRow = z.infer<typeof AnalyticsRowSchema>;
export const AnalyticsDatasetSchema = z.object({ rows: z.array(AnalyticsRowSchema).max(5000) });
export const LedgerPageSchema = z.object({
  rows: z.array(LedgerRowSchema),
  nextCursor: z.string().nullable(),
});

export const STUDIO_TOOL_NAMES = [
  'view_schema',
  'view_report',
  'view_page',
  'view_widget',
  'execute_query',
  'create_expression',
  'update_expression',
  'delete_expression',
  'add_widget',
  'position_widget',
  'remove_widget',
  'configure_widget',
  'add_page_filter',
  'remove_page_filter',
  'add_widget_filter',
  'remove_widget_filter',
  'view_plan',
  'create_plan',
  'update_plan',
  'clear_plan',
  'rename_thread',
  'delegate_to',
  'complete_task',
] as const;
export const StudioToolNameSchema = z.enum(STUDIO_TOOL_NAMES);
const ToolCallSchema = z.strictObject({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.strictObject({
    name: StudioToolNameSchema,
    arguments: z.string().max(8000),
  }),
});
export const StudioMessageSchema = z.strictObject({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant', 'tool', 'system', 'developer']),
  content: z.string().max(32000).optional(),
  name: z.string().max(100).optional(),
  toolCallId: z.string().max(200).optional(),
  toolCalls: z.array(ToolCallSchema).max(10).optional(),
  error: z.string().max(1000).optional(),
});
export const StudioToolSchema = z.strictObject({
  name: z.string().regex(/^[a-z_]{1,80}$/),
  description: z.string().max(4000),
  parameters: z.record(z.string(), z.unknown()),
  kind: z.literal('client').optional(),
});
export const StudioTurnRequestSchema = z.strictObject({
  threadId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200).optional(),
  messages: z.array(StudioMessageSchema).min(1).max(80),
  tools: z.array(StudioToolSchema).max(24),
});
export type StudioTurnRequest = z.infer<typeof StudioTurnRequestSchema>;
export const StudioModelResultSchema = z.strictObject({
  text: z.string().max(12000).optional(),
  calls: z
    .array(
      z.strictObject({
        name: StudioToolNameSchema,
        args: z.record(z.string(), z.unknown()),
      }),
    )
    .max(8),
});
export const StudioEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RUN_STARTED'), threadId: z.string(), runId: z.string() }),
  z.object({ type: z.literal('RUN_FINISHED'), threadId: z.string(), runId: z.string() }),
  z.object({ type: z.literal('RUN_ERROR'), message: z.string(), code: z.string().optional() }),
  z.object({
    type: z.literal('TEXT_MESSAGE_START'),
    messageId: z.string(),
    role: z.literal('assistant'),
  }),
  z.object({ type: z.literal('TEXT_MESSAGE_CONTENT'), messageId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('TEXT_MESSAGE_END'), messageId: z.string() }),
  z.object({
    type: z.literal('TOOL_CALL_START'),
    toolCallId: z.string(),
    toolCallName: StudioToolNameSchema,
  }),
  z.object({ type: z.literal('TOOL_CALL_ARGS'), toolCallId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('TOOL_CALL_END'), toolCallId: z.string() }),
]);

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
    catalog: CheckStatusSchema,
    ai: CheckStatusSchema,
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Public values only: nothing here may be a secret. */
export const PublicConfigSchema = z.object({
  paypalClientId: z.string(),
  productSource: z.enum(['channel3', 'fixture']),
  aiProvider: z.enum(['gemini', 'rule']),
  environment: z.literal('sandbox'),
  merchantPresets: z.array(z.string()),
  scenarioPresets: z.array(
    z.strictObject({
      id: z.enum(['HAPPY_PATH', 'BLOCKED_OFFER', 'PRECAPTURE_DRIFT']),
      label: z.string(),
      requestText: z.string(),
    }),
  ),
  demoControlsEnabled: z.boolean(),
  studioAgentEnabled: z.boolean().default(false),
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
