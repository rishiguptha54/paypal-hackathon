import {
  boolean,
  bigint,
  bigserial,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { PURCHASE_STATES, type ClarificationQuestion, type Finding } from '@intentlock/shared';

export const purchaseState = pgEnum('purchase_state', PURCHASE_STATES);
export const mandateStatus = pgEnum('mandate_status', [
  'DRAFT',
  'NEEDS_CLARIFICATION',
  'CONFIRMED',
  'SUPERSEDED',
]);
export const offerSource = pgEnum('offer_source', ['channel3', 'fixture']);
export const recurrenceSignal = pgEnum('recurrence_signal', ['NONE', 'RECURRING', 'AMBIGUOUS']);
export const evaluationDecision = pgEnum('evaluation_decision', [
  'ALLOWED',
  'BLOCKED',
  'NEEDS_REVIEW',
]);
export const paymentOpKind = pgEnum('payment_op_kind', ['CREATE_ORDER', 'CAPTURE']);
export const paymentOpChannel = pgEnum('payment_op_channel', ['mcp', 'rest']);
export const paymentOpStatus = pgEnum('payment_op_status', ['STARTED', 'SUCCEEDED', 'FAILED']);
export const driftKind = pgEnum('drift_kind', ['PRICE_HIKE', 'MERCHANT_SWAP', 'APPROVAL_EXPIRED']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});

export const mandates = pgTable(
  'mandates',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => mandates.id),
    status: mandateStatus('status').notNull(),
    requestText: text('request_text').notNull(),
    productQuery: text('product_query'),
    quantity: integer('quantity'),
    maxTotalMinor: bigint('max_total_minor', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }),
    allowedMerchantDomains: text('allowed_merchant_domains')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    recurringAllowed: boolean('recurring_allowed').notNull().default(false),
    excludedTerms: text('excluded_terms')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    clarificationQuestions: jsonb('clarification_questions')
      .$type<ClarificationQuestion[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    parser: text('parser').notNull(),
    confirmedAt: ts('confirmed_at'),
    seeded: boolean('seeded').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('mandates_quantity_check', sql`${t.quantity} IS NULL OR ${t.quantity} BETWEEN 1 AND 100`),
    check('mandates_max_total_check', sql`${t.maxTotalMinor} IS NULL OR ${t.maxTotalMinor} > 0`),
    check(
      'mandates_confirmed_fields_check',
      sql`${t.status} <> 'CONFIRMED' OR (${t.quantity} IS NOT NULL AND ${t.maxTotalMinor} IS NOT NULL AND ${t.currency} = 'USD' AND cardinality(${t.allowedMerchantDomains}) BETWEEN 1 AND 20)`,
    ),
    index('mandates_session_created_idx').on(t.sessionId, t.createdAt),
  ],
);

export const offerSnapshots = pgTable(
  'offer_snapshots',
  {
    id: uuid('id').primaryKey(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    source: offerSource('source').notNull(),
    sourceProductId: text('source_product_id').notNull(),
    title: text('title').notNull(),
    brand: text('brand'),
    merchantName: text('merchant_name'),
    merchantDomain: text('merchant_domain'),
    offerUrl: text('offer_url'),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }),
    recurrenceSignal: recurrenceSignal('recurrence_signal').notNull(),
    recurrenceEvidence: text('recurrence_evidence'),
    rawSha256: char('raw_sha256', { length: 64 }).notNull(),
    observedAt: ts('observed_at').notNull(),
  },
  (t) => [index('offer_snapshots_mandate_idx').on(t.mandateId)],
);

export const evaluations = pgTable('evaluations', {
  id: uuid('id').primaryKey(),
  offerSnapshotId: uuid('offer_snapshot_id')
    .notNull()
    .unique()
    .references(() => offerSnapshots.id),
  decision: evaluationDecision('decision').notNull(),
  findings: jsonb('findings').$type<Finding[]>().notNull(),
  policyVersion: text('policy_version').notNull(),
  evaluatedAt: ts('evaluated_at').notNull(),
});

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    mandateId: uuid('mandate_id').references(() => mandates.id),
    offerSnapshotId: uuid('offer_snapshot_id').references(() => offerSnapshots.id),
    mandateHash: char('mandate_hash', { length: 64 }),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    state: purchaseState('state').notNull(),
    version: integer('version').notNull().default(1),
    approvedAt: ts('approved_at'),
    approvalExpiresAt: ts('approval_expires_at'),
    paypalOrderId: text('paypal_order_id'),
    paypalCaptureId: text('paypal_capture_id'),
    paypalStatus: text('paypal_status'),
    blockReasons: jsonb('block_reasons').$type<Finding[]>(),
    simulatedDrift: driftKind('simulated_drift'),
    seeded: boolean('seeded').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('purchases_total_check', sql`${t.totalMinor} = ${t.unitAmountMinor} * ${t.quantity}`),
    check('purchases_quantity_check', sql`${t.quantity} BETWEEN 1 AND 100`),
    check('purchases_currency_check', sql`${t.currency} = 'USD'`),
    check('purchases_unit_positive_check', sql`${t.unitAmountMinor} > 0`),
    check(
      'purchases_captured_has_capture_id',
      sql`${t.seeded} OR ${t.state} <> 'CAPTURED' OR ${t.paypalCaptureId} IS NOT NULL`,
    ),
    uniqueIndex('purchases_paypal_order_id_uq').on(t.paypalOrderId),
    uniqueIndex('purchases_paypal_capture_id_uq').on(t.paypalCaptureId),
    index('purchases_session_idx').on(t.sessionId),
  ],
);

export const paymentOperations = pgTable(
  'payment_operations',
  {
    id: uuid('id').primaryKey(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    kind: paymentOpKind('kind').notNull(),
    channel: paymentOpChannel('channel').notNull(),
    mcpTool: text('mcp_tool'),
    paypalRequestId: uuid('paypal_request_id').notNull(),
    status: paymentOpStatus('status').notNull().default('STARTED'),
    httpStatus: integer('http_status'),
    paypalDebugId: text('paypal_debug_id'),
    errorCode: text('error_code'),
    resultOrderId: text('result_order_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_operations_purchase_kind_uq').on(t.purchaseId, t.kind),
    uniqueIndex('payment_operations_request_id_uq').on(t.paypalRequestId),
    check(
      'payment_operations_capture_is_rest',
      sql`${t.kind} <> 'CAPTURE' OR ${t.channel} = 'rest'`,
    ),
  ],
);

export type PurchaseRow = typeof purchases.$inferSelect;
export type PaymentOperationRow = typeof paymentOperations.$inferSelect;

export const auditEvents = pgTable(
  'audit_events',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    id: uuid('id').notNull().unique(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    mandateId: uuid('mandate_id'),
    purchaseId: uuid('purchase_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    prevHash: char('prev_hash', { length: 64 }).notNull(),
    entryHash: char('entry_hash', { length: 64 }).notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('audit_events_session_seq_idx').on(t.sessionId, t.seq),
    index('audit_events_purchase_seq_idx').on(t.purchaseId, t.seq),
  ],
);
export type AuditEventRow = typeof auditEvents.$inferSelect;
