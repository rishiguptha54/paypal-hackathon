import { writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createDocument } from 'zod-openapi';
import { stringify } from 'yaml';
import {
  AnalyticsDatasetSchema,
  AnalyticsQuerySchema,
  ApprovePurchaseRequestSchema,
  AuditQuerySchema,
  AuditVerificationSchema,
  CancelPurchaseRequestSchema,
  CaptureRequestSchema,
  CreateMandateRequestSchema,
  CreateOrderRequestSchema,
  CreateOrderResponseSchema,
  CreatePurchaseRequestSchema,
  DemoSeedRequestSchema,
  ErrorEnvelopeSchema,
  EvaluatedOfferSchema,
  HealthResponseSchema,
  IntentReceiptSchema,
  LedgerPageSchema,
  MandateFieldsSchema,
  MandateSchema,
  PublicConfigSchema,
  PurchaseSchema,
  SearchOffersRequestSchema,
  SimulateDriftRequestSchema,
  StudioTurnRequestSchema,
} from '@intentlock/shared';
import { z } from 'zod';

const idParams = z.object({ id: z.uuid() });
const result = (schema: z.ZodType, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const failures = (codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [
      code,
      {
        description: code === 400 ? 'Invalid or unexpected request fields.' : 'Request rejected.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    ]),
  );
const body = (schema: z.ZodType) => ({
  requestBody: { required: true, content: { 'application/json': { schema } } },
});

const document = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'IntentLock API',
    version: '1.0.0',
    description: 'Session-scoped policy-governed procurement API. PayPal Sandbox only.',
  },
  servers: [{ url: '/api' }],
  paths: {
    '/health': {
      get: {
        summary: 'Read dependency status values',
        responses: {
          '200': result(HealthResponseSchema, 'Health status values only.'),
          ...failures([503]),
        },
      },
    },
    '/config': {
      get: {
        summary: 'Read public configuration and judge presets',
        responses: {
          '200': result(PublicConfigSchema, 'Public client configuration. No secrets.'),
          ...failures([503]),
        },
      },
    },
    '/mandates': {
      post: {
        summary: 'Parse purchase intent into a draft mandate',
        ...body(CreateMandateRequestSchema),
        responses: {
          '201': result(MandateSchema, 'Draft mandate or clarification questions.'),
          ...failures([400, 429, 502, 504]),
        },
      },
    },
    '/mandates/{id}': {
      get: {
        summary: 'Read a session-owned mandate',
        requestParams: { path: idParams },
        responses: {
          '200': result(MandateSchema, 'Mandate.'),
          ...failures([404]),
        },
      },
    },
    '/mandates/{id}/confirm': {
      post: {
        summary: 'Confirm or version a mandate',
        requestParams: { path: idParams },
        ...body(MandateFieldsSchema),
        responses: {
          '200': result(MandateSchema, 'Confirmed mandate.'),
          ...failures([400, 404, 409]),
        },
      },
    },
    '/mandates/{id}/search': {
      post: {
        summary: 'Search and evaluate catalog offers',
        requestParams: { path: idParams },
        ...body(SearchOffersRequestSchema),
        responses: {
          '200': result(
            z.object({
              source: z.enum(['channel3', 'fixture']),
              offers: z.array(EvaluatedOfferSchema),
            }),
            'Offer snapshots and deterministic evaluations.',
          ),
          ...failures([400, 404, 409, 504]),
        },
      },
    },
    '/purchases': {
      post: {
        summary: 'Create a purchase from a freshly evaluated allowed offer',
        ...body(CreatePurchaseRequestSchema),
        responses: {
          '201': result(PurchaseSchema, 'Purchase with server-calculated money and mandate hash.'),
          ...failures([400, 409]),
        },
      },
    },
    '/purchases/{id}': {
      get: {
        summary: 'Read and reconcile a purchase',
        requestParams: { path: idParams },
        responses: {
          '200': result(PurchaseSchema, 'Session-owned purchase.'),
          ...failures([404, 504]),
        },
      },
    },
    '/purchases/{id}/approve': {
      post: {
        summary: 'Approve the exact server-generated mandate hash',
        requestParams: { path: idParams },
        ...body(ApprovePurchaseRequestSchema),
        responses: {
          '200': result(PurchaseSchema, 'Approved purchase and expiry.'),
          ...failures([400, 404, 409]),
        },
      },
    },
    '/purchases/{id}/cancel': {
      post: {
        summary: 'Cancel an eligible purchase',
        requestParams: { path: idParams },
        ...body(CancelPurchaseRequestSchema),
        responses: {
          '200': result(PurchaseSchema, 'Cancelled purchase.'),
          ...failures([400, 404, 409]),
        },
      },
    },
    '/purchases/{id}/paypal/create-order': {
      post: {
        summary: 'Create and bind a Sandbox PayPal order',
        requestParams: { path: idParams },
        ...body(CreateOrderRequestSchema),
        responses: {
          '200': result(CreateOrderResponseSchema, 'Existing or newly created order.'),
          ...failures([400, 404, 409, 502, 504]),
        },
      },
    },
    '/purchases/{id}/paypal/capture': {
      post: {
        summary: 'Verify the live order and capture once',
        requestParams: { path: idParams },
        ...body(CaptureRequestSchema),
        responses: {
          '200': result(PurchaseSchema, 'Verified capture result.'),
          ...failures([400, 404, 409, 502, 504]),
        },
      },
    },
    '/audit': {
      get: {
        summary: 'Read the session-scoped decision ledger',
        requestParams: { query: AuditQuerySchema },
        responses: {
          '200': result(LedgerPageSchema, 'Cursor-paginated ledger.'),
          ...failures([400, 429]),
        },
      },
    },
    '/audit/verify': {
      get: {
        summary: 'Verify the session audit hash chain',
        responses: {
          '200': result(
            AuditVerificationSchema,
            'Chain status, checked count, and first broken index.',
          ),
          ...failures([400]),
        },
      },
    },
    '/purchases/{id}/receipt': {
      get: {
        summary: 'Read a purchase intent receipt',
        requestParams: { path: idParams },
        responses: {
          '200': result(IntentReceiptSchema, 'Purchase receipt and MCP trace.'),
          ...failures([404]),
        },
      },
    },
    '/offers/{id}/receipt': {
      get: {
        summary: 'Read an offer intent receipt',
        requestParams: { path: idParams },
        responses: {
          '200': result(IntentReceiptSchema, 'Offer receipt.'),
          ...failures([404]),
        },
      },
    },
    '/purchases/{id}/simulate-drift': {
      post: {
        summary: 'Store a fail-only capture drift simulation',
        requestParams: { path: idParams },
        ...body(SimulateDriftRequestSchema),
        responses: {
          '200': result(PurchaseSchema, 'Purchase with simulated drift.'),
          ...failures([400, 404, 409]),
        },
      },
    },
    '/demo/seed': {
      post: {
        summary: 'Idempotently seed labelled sample history',
        ...body(DemoSeedRequestSchema),
        responses: {
          '200': result(
            z.object({
              seeded: z.object({
                mandates: z.number(),
                evaluations: z.number(),
                purchases: z.number(),
              }),
            }),
            'Sample history already exists.',
          ),
          '201': result(
            z.object({
              seeded: z.object({
                mandates: z.number(),
                evaluations: z.number(),
                purchases: z.number(),
              }),
            }),
            'Sample history created; no PayPal or MCP calls.',
          ),
          ...failures([400, 404, 429]),
        },
      },
    },
    '/analytics/dataset': {
      get: {
        summary: 'Read session-scoped governance analytics',
        requestParams: { query: AnalyticsQuerySchema },
        responses: {
          '200': result(AnalyticsDatasetSchema, 'At most 5,000 session rows.'),
          ...failures([400, 429]),
        },
      },
    },
    '/studio-agent/turn': {
      post: {
        summary: 'Request a restricted Governance Analyst turn',
        ...body(StudioTurnRequestSchema),
        responses: {
          '200': {
            description: 'AG-UI-compatible server-sent events.',
            content: { 'text/event-stream': { schema: z.string().describe('AG-UI event stream') } },
          },
          ...failures([400, 404, 409, 429, 502, 503, 504]),
        },
      },
    },
  },
});
const output = `${stringify(document, { lineWidth: 110 })}`;
const target = new URL('../docs/openapi.yaml', import.meta.url);
if (process.argv.includes('--check')) {
  const actual = readFileSync(target, 'utf8');
  if (actual !== output) {
    process.stderr.write('docs/openapi.yaml is stale. Run npm run openapi:generate.\n');
    process.exitCode = 1;
  }
} else {
  const temporary = new URL(`../docs/openapi.${process.pid}.tmp`, import.meta.url);
  try {
    writeFileSync(temporary, output, { flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
