import {
  bigint,
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
import { sql } from 'drizzle-orm';
import { PURCHASE_STATES } from '@intentlock/shared';

export const purchaseState = pgEnum('purchase_state', PURCHASE_STATES);
export const paymentOpKind = pgEnum('payment_op_kind', ['CREATE_ORDER', 'CAPTURE']);
export const paymentOpChannel = pgEnum('payment_op_channel', ['mcp', 'rest']);
export const paymentOpStatus = pgEnum('payment_op_status', ['STARTED', 'SUCCEEDED', 'FAILED']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});

/** Minimal Stage 1 shape. Mandate / offer / hash columns arrive with later stages. */
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
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
    blockReasons: jsonb('block_reasons').$type<string[]>(),
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
      sql`${t.state} <> 'CAPTURED' OR ${t.paypalCaptureId} IS NOT NULL`,
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
