import type { MandateHashFields, Purchase } from '@intentlock/shared';
import { captureGate } from '../core/captureGate';
import { evaluate } from '../core/policy';
import { parseMoneyDecimal } from '../core/money';
import { AppError, UpstreamError, notFound, stateConflict, toAppError } from '../errors';
import type { Logger } from '../logger';
import type {
  GatewayCall,
  McpTrace,
  PayPalOrderGateway,
  ToolName,
} from '../adapters/paypalMcp/gateway';
import type { PayPalRestClient } from '../adapters/paypal/client';
import type { PayPalOrder } from '../adapters/paypal/schemas';
import type { Db } from '../repo/db';
import { appendAudit, lockSession } from '../repo/audit';
import { claimOperation, finishOperation, storeOperationOrder } from '../repo/paymentOperations';
import {
  getPurchase,
  purchaseGateEvidence,
  toPurchaseDto,
  transitionPurchase,
} from '../repo/purchases';
import type { PurchaseRow } from '../repo/schema';
import { mandateFields, snapshotToNormalizedOffer } from './offers';

export interface PaymentServiceDeps {
  db: Db;
  gateway: PayPalOrderGateway;
  rest: PayPalRestClient;
  policyVersion: string;
  now?: () => Date;
}

export class PaymentService {
  private readonly now: () => Date;

  constructor(private readonly d: PaymentServiceDeps) {
    this.now = d.now ?? (() => new Date());
  }

  async createPayPalOrder(
    sessionId: string,
    purchaseId: string,
    log: Logger,
  ): Promise<{ paypalOrderId: string }> {
    const { db, gateway, rest } = this.d;
    const prepared = await db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const p = await this.load(sessionId, purchaseId, tx);
      if (p.seeded) throw stateConflict('Sample purchases cannot call PayPal.');
      if (p.paypalOrderId) return { existing: p.paypalOrderId };
      if (p.state !== 'APPROVED' || !p.mandateHash || !p.approvedAt)
        throw stateConflict('Purchase is not approved for order creation.');
      if (!p.approvalExpiresAt || p.approvalExpiresAt <= this.now()) {
        await transitionPurchase(tx, p, 'EXPIRED');
        await appendAudit(tx, {
          sessionId,
          purchaseId,
          mandateId: p.mandateId,
          type: 'PURCHASE_EXPIRED',
          payload: { reason: 'APPROVAL_EXPIRED' },
        });
        return { expired: true };
      }
      const { op, claimed } = await claimOperation(tx, {
        purchaseId,
        kind: 'CREATE_ORDER',
        channel: 'mcp',
        mcpTool: 'create_order',
      });
      if (!claimed)
        throw stateConflict('Order creation is in progress or requires reconciliation.');
      return { p, op };
    });
    if (prepared.existing) return { paypalOrderId: prepared.existing };
    if (prepared.expired) throw new AppError(409, 'APPROVAL_EXPIRED', 'The approval has expired.');
    const { p, op } = prepared;
    if (!p || !op) throw new Error('Missing prepared order');
    let orderId = op.resultOrderId;
    let channel = op.channel;
    let debugId: string | undefined;
    let httpStatus: number | undefined;
    if (!orderId) {
      const started = Date.now();
      let call;
      try {
        call = await gateway.createOrder({
          purchaseId,
          requestId: op.paypalRequestId,
          itemName: p.itemName,
          quantity: p.quantity,
          unitAmountMinor: p.unitAmountMinor,
        });
      } catch (error) {
        await db.transaction(async (tx) => {
          await lockSession(tx, sessionId);
          await this.trace(tx, p, failedTrace('create_order', started, error));
          await finishOperation(tx, op.id, {
            ...failure(error),
            channel: error instanceof UpstreamError && error.provider === 'paypal' ? 'rest' : 'mcp',
            errorCode:
              error instanceof UpstreamError && error.provider === 'paypal'
                ? error.meta.issue
                : 'MCP_OUTCOME_UNKNOWN',
          });
        });
        throw error instanceof UpstreamError ? toAppError(error) : error;
      }
      orderId = call.data.id;
      channel = call.trace.channel;
      debugId = call.debugId;
      httpStatus = call.httpStatus;
      await db.transaction(async (tx) => {
        await lockSession(tx, sessionId);
        await storeOperationOrder(tx, op.id, call.data.id, channel);
        await this.trace(tx, p, call.trace);
      });
    }

    // This PATCH happens before the order ID reaches the browser, never after approval.
    try {
      if (channel === 'mcp') await rest.bindOrder(orderId, purchaseId, op.paypalRequestId);
    } catch (error) {
      await db.transaction(async (tx) => {
        await lockSession(tx, sessionId);
        await finishOperation(tx, op.id, failure(error));
      });
      throw error instanceof UpstreamError ? toAppError(error) : error;
    }
    await db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const moved = await transitionPurchase(tx, p, 'ORDER_CREATED', {
        paypalOrderId: orderId,
        paypalStatus: 'CREATED',
      });
      if (!moved) throw stateConflict('Purchase changed while creating the order.');
      await finishOperation(tx, op.id, {
        status: 'SUCCEEDED',
        channel,
        mcpTool: channel === 'mcp' ? 'create_order' : null,
        httpStatus,
        paypalDebugId: debugId,
      });
      await appendAudit(tx, {
        sessionId,
        purchaseId,
        mandateId: p.mandateId,
        type: 'PAYPAL_ORDER_CREATED',
        payload: { paypalOrderId: orderId, channel, paypalDebugId: debugId },
      });
    });
    log.info({ purchaseId, paypalOrderId: orderId, channel }, 'paypal order created and bound');
    return { paypalOrderId: orderId };
  }

  async capturePayPalOrder(
    sessionId: string,
    purchaseId: string,
    paypalOrderId: string,
    log: Logger,
  ): Promise<Purchase> {
    const p = await this.load(sessionId, purchaseId);
    if (p.seeded) throw stateConflict('Sample purchases cannot call PayPal.');
    if (
      (p.state === 'CAPTURED' || p.state === 'CAPTURE_PENDING') &&
      p.paypalOrderId === paypalOrderId
    )
      return toPurchaseDto(p);
    if (p.state !== 'ORDER_CREATED' || !p.paypalOrderId)
      throw stateConflict('Purchase has no PayPal order ready for capture.');

    const live = await this.readOrder(p);
    const prepared = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      await this.trace(tx, p, live.trace);
      const current = await this.load(sessionId, purchaseId, tx);
      if (current.state !== 'ORDER_CREATED' || current.version !== p.version)
        return { conflict: true };
      const context = await this.gateContext(tx, current);
      const failed = captureGate({
        purchase: current,
        requestedOrderId: paypalOrderId,
        live: live.data,
        ...context,
        now: this.now(),
      });
      if (failed.length) {
        const blocked = await transitionPurchase(tx, current, 'BLOCKED_AT_CAPTURE', {
          blockReasons: failed,
          paypalStatus: live.data.status,
        });
        if (!blocked) return { conflict: true };
        await appendAudit(tx, {
          sessionId,
          purchaseId,
          mandateId: current.mandateId,
          type: 'CAPTURE_BLOCKED',
          payload: {
            findings: failed,
            reasonCodes: failed.map((f) => f.code),
            simulated: current.simulatedDrift !== null,
          },
        });
        return { failed };
      }
      const { op, claimed } = await claimOperation(tx, {
        purchaseId,
        kind: 'CAPTURE',
        channel: 'rest',
        mcpTool: null,
      });
      if (!claimed) return { conflict: true };
      const capturing = await transitionPurchase(tx, current, 'CAPTURING', {
        paypalStatus: live.data.status,
      });
      if (!capturing) throw stateConflict('Capture is already in progress.');
      return { capturing, op };
    });
    if (prepared.conflict) throw stateConflict('Purchase changed while verifying capture.');
    if (prepared.failed)
      throw new AppError(
        409,
        'CAPTURE_BLOCKED',
        'Capture failed verification.',
        prepared.failed.map((finding) => ({ code: finding.code })),
      );
    if (!prepared.capturing || !prepared.op) throw new Error('Missing capture claim');
    return this.performCapture(
      prepared.capturing,
      prepared.op.id,
      prepared.op.paypalRequestId,
      log,
    );
  }

  /** Reconciliation reads PayPal first; it never assumes a timed-out capture failed. */
  async get(sessionId: string, id: string, log: Logger): Promise<Purchase> {
    const p = await this.load(sessionId, id);
    const stale = this.now().getTime() - p.updatedAt.getTime() > 60_000;
    if (
      p.seeded ||
      !p.paypalOrderId ||
      !(p.state === 'CAPTURE_PENDING' || (p.state === 'CAPTURING' && stale))
    )
      return toPurchaseDto(p);
    const live = await this.readOrder(p);
    const reconciled = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      await this.trace(tx, p, live.trace);
      const current = await this.load(sessionId, id, tx);
      if (current.version !== p.version) return { row: current };
      const unit = live.data.purchase_units[0];
      if (
        live.data.id !== p.paypalOrderId ||
        live.data.purchase_units.length !== 1 ||
        unit?.custom_id !== p.id ||
        parseMoneyDecimal(unit.amount.value) !== p.totalMinor ||
        unit.amount.currency_code !== p.currency
      )
        return {
          error: new UpstreamError('paypal', 'error', 'Reconciliation order binding is invalid'),
        };
      const captures = unit.payments?.captures ?? [];
      const capture = captures.length === 1 ? captures[0] : undefined;
      if (capture) {
        if (
          (p.paypalCaptureId !== null && capture.id !== p.paypalCaptureId) ||
          (capture.amount &&
            (parseMoneyDecimal(capture.amount.value) !== p.totalMinor ||
              capture.amount.currency_code !== p.currency))
        ) {
          return {
            error: new UpstreamError('paypal', 'error', 'Reconciliation capture amount is invalid'),
          };
        }
        const next =
          capture.status === 'COMPLETED'
            ? 'CAPTURED'
            : capture.status === 'PENDING'
              ? 'CAPTURE_PENDING'
              : 'CAPTURE_FAILED';
        if (p.state === next) return { row: current };
        const row = await transitionPurchase(tx, current, next, {
          paypalCaptureId: capture.id,
          paypalStatus: live.data.status,
        });
        if (!row) throw stateConflict('Purchase changed while reconciling.');
        const { op } = await claimOperation(tx, {
          purchaseId: p.id,
          kind: 'CAPTURE',
          channel: 'rest',
          mcpTool: null,
        });
        await finishOperation(tx, op.id, {
          status: next === 'CAPTURE_FAILED' ? 'FAILED' : 'SUCCEEDED',
        });
        await appendAudit(tx, {
          sessionId,
          purchaseId: p.id,
          mandateId: p.mandateId,
          type: resultEvent(next),
          payload: { captureId: capture.id, status: capture.status, reconciled: true },
        });
        return { row };
      }
      if (p.state === 'CAPTURING' && live.data.status === 'APPROVED' && captures.length === 0) {
        // A safe retry still reruns every gate and keeps the original capture request ID.
        const row = await transitionPurchase(tx, current, 'ORDER_CREATED', {
          paypalStatus: live.data.status,
        });
        if (!row) throw stateConflict('Purchase changed while reconciling.');
        const { op } = await claimOperation(tx, {
          purchaseId: p.id,
          kind: 'CAPTURE',
          channel: 'rest',
          mcpTool: null,
        });
        await finishOperation(tx, op.id, { status: 'FAILED', errorCode: 'RETRY_AFTER_RECONCILE' });
        return { row };
      }
      return { row: current };
    });
    if (reconciled.error) throw toAppError(reconciled.error);
    if (!reconciled.row) throw new Error('Missing reconciliation result');
    log.info({ purchaseId: id, state: reconciled.row.state }, 'capture reconciled');
    return toPurchaseDto(reconciled.row);
  }

  private async gateContext(tx: Db, p: PurchaseRow) {
    const { mandate, snapshot, created } = await purchaseGateEvidence(tx, p);
    const approvedMerchantDomain =
      typeof created?.payload['merchantDomain'] === 'string'
        ? created.payload['merchantDomain']
        : null;
    let currentHashFields: MandateHashFields | null = null;
    let policyAllowed = false;
    if (
      mandate &&
      snapshot &&
      snapshot.mandateId === mandate.id &&
      mandate.quantity !== null &&
      snapshot.unitAmountMinor !== null &&
      snapshot.merchantDomain !== null
    ) {
      currentHashFields = {
        mandateId: mandate.id,
        mandateVersion: mandate.version,
        offerId: snapshot.id,
        merchantDomain: snapshot.merchantDomain,
        quantity: mandate.quantity,
        unitPriceMinor: snapshot.unitAmountMinor.toString(),
        totalMinor: (snapshot.unitAmountMinor * BigInt(mandate.quantity)).toString(),
        currency: snapshot.currency ?? '',
        recurring: snapshot.recurrenceSignal === 'RECURRING',
      };
      if (mandate.status === 'CONFIRMED') {
        policyAllowed =
          evaluate(
            mandateFields(mandate),
            snapshotToNormalizedOffer(snapshot),
            this.d.policyVersion,
            this.now(),
          ).decision === 'ALLOWED';
      }
      if (mandate.status !== 'CONFIRMED') currentHashFields = null;
    }
    return { currentHashFields, approvedMerchantDomain, policyAllowed };
  }

  private async readOrder(p: PurchaseRow): Promise<GatewayCall<PayPalOrder>> {
    const started = Date.now();
    try {
      return await this.d.gateway.getOrder(p.paypalOrderId ?? '');
    } catch (error) {
      await this.d.db.transaction(async (tx) => {
        await lockSession(tx, p.sessionId);
        await this.trace(tx, p, failedTrace('get_order', started, error));
      });
      if (!(error instanceof UpstreamError)) throw error;
      throw toAppError(
        new UpstreamError(error.provider, 'timeout', 'Both live order reads failed'),
      );
    }
  }

  private async performCapture(
    p: PurchaseRow,
    opId: string,
    requestId: string,
    log: Logger,
  ): Promise<Purchase> {
    let response;
    try {
      response = await this.d.rest.captureOrder(p.paypalOrderId ?? '', requestId);
      if (
        response.data.id !== p.paypalOrderId ||
        response.data.purchase_units.length !== 1 ||
        response.data.purchase_units[0]?.payments.captures.length !== 1
      ) {
        throw new UpstreamError('paypal', 'error', 'Capture response does not match the order');
      }
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      await this.d.db.transaction(async (tx) => {
        await lockSession(tx, p.sessionId);
        await finishOperation(tx, opId, failure(error));
        const declined = error.meta.issue === 'INSTRUMENT_DECLINED';
        const definiteFailure =
          error.meta.httpStatus !== undefined &&
          error.meta.httpStatus >= 400 &&
          error.meta.httpStatus < 500;
        if (declined || definiteFailure) {
          const moved = await transitionPurchase(
            tx,
            p,
            declined ? 'ORDER_CREATED' : 'CAPTURE_FAILED',
          );
          if (!moved) throw stateConflict('Purchase changed during failed capture.');
        }
        await appendAudit(tx, {
          sessionId: p.sessionId,
          purchaseId: p.id,
          mandateId: p.mandateId,
          type: declined ? 'PAYPAL_INSTRUMENT_DECLINED' : 'PAYPAL_CAPTURE_FAILED',
          payload: {
            errorCode: error.meta.issue,
            paypalDebugId: error.meta.debugId,
            outcomeUnknown: !declined && !definiteFailure,
          },
        });
      });
      log.warn(
        { purchaseId: p.id, paypalDebugId: error.meta.debugId },
        'capture failed or outcome unknown',
      );
      if (error.meta.issue === 'INSTRUMENT_DECLINED')
        throw new AppError(409, 'INSTRUMENT_DECLINED', 'The payment method was declined. Retry.');
      throw toAppError(error);
    }
    const capture = response.data.purchase_units[0]?.payments.captures[0];
    if (!capture) throw new UpstreamError('paypal', 'error', 'Capture missing');
    const next =
      capture.status === 'COMPLETED'
        ? 'CAPTURED'
        : capture.status === 'PENDING'
          ? 'CAPTURE_PENDING'
          : 'CAPTURE_FAILED';
    const done = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, p.sessionId);
      const row = await transitionPurchase(tx, p, next, {
        paypalCaptureId: capture.id,
        paypalStatus: response.data.status,
      });
      if (!row) throw stateConflict('Purchase changed during capture.');
      await finishOperation(tx, opId, {
        status: next === 'CAPTURE_FAILED' ? 'FAILED' : 'SUCCEEDED',
        httpStatus: response.httpStatus,
        paypalDebugId: response.debugId,
      });
      await appendAudit(tx, {
        sessionId: p.sessionId,
        purchaseId: p.id,
        mandateId: p.mandateId,
        type: resultEvent(next),
        payload: { captureId: capture.id, status: capture.status, paypalDebugId: response.debugId },
      });
      return row;
    });
    return toPurchaseDto(done);
  }

  private async trace(tx: Db, p: PurchaseRow, trace: McpTrace) {
    await appendAudit(tx, {
      sessionId: p.sessionId,
      purchaseId: p.id,
      mandateId: p.mandateId,
      type: 'PAYPAL_MCP_CALL',
      payload: {
        mcpTool: trace.tool,
        status: trace.status.toUpperCase(),
        durationMs: trace.durationMs,
        at: trace.at,
        paypalOrderId: trace.orderId ?? p.paypalOrderId,
        fallbackToRest: trace.fallbackToRest,
        channel: trace.channel,
      },
    });
  }

  private async load(sessionId: string, id: string, db = this.d.db): Promise<PurchaseRow> {
    const p = await getPurchase(db, sessionId, id);
    if (!p) throw notFound();
    return p;
  }
}

function resultEvent(state: 'CAPTURED' | 'CAPTURE_PENDING' | 'CAPTURE_FAILED') {
  return state === 'CAPTURED'
    ? 'PAYPAL_CAPTURED'
    : state === 'CAPTURE_PENDING'
      ? 'PAYPAL_CAPTURE_PENDING'
      : 'PAYPAL_CAPTURE_FAILED';
}

function failure(error: unknown) {
  return {
    status: 'FAILED' as const,
    httpStatus: error instanceof UpstreamError ? error.meta.httpStatus : undefined,
    paypalDebugId: error instanceof UpstreamError ? error.meta.debugId : undefined,
    errorCode: error instanceof UpstreamError ? error.meta.issue : undefined,
  };
}

function failedTrace(tool: ToolName, started: number, error: unknown): McpTrace {
  return {
    tool,
    channel: 'mcp',
    status: error instanceof UpstreamError && error.kind === 'timeout' ? 'timeout' : 'error',
    durationMs: Date.now() - started,
    at: new Date(started).toISOString(),
    fallbackToRest: error instanceof UpstreamError && error.provider === 'paypal',
  };
}
