import type { Purchase } from '@intentlock/shared';
import { minimalCaptureChecks } from '../core/captureChecks';
import { AppError, UpstreamError, notFound, stateConflict, toAppError } from '../errors';
import type { Logger } from '../logger';
import type { PayPalOrderGateway } from '../adapters/paypalMcp/gateway';
import type { PayPalRestClient } from '../adapters/paypal/client';
import type { Db } from '../repo/db';
import { claimOperation, finishOperation } from '../repo/paymentOperations';
import { getPurchase, insertPurchase, toPurchaseDto, transitionPurchase } from '../repo/purchases';
import type { PurchaseRow } from '../repo/schema';

export interface PaymentServiceDeps {
  db: Db;
  gateway: PayPalOrderGateway;
  rest: PayPalRestClient;
  approvalTtlSeconds: number;
  now?: () => Date;
}

const TEMP_ITEM = { name: 'IntentLock sandbox test item', quantity: 1, unitMinor: 100n };

export class PaymentService {
  private readonly now: () => Date;

  constructor(private readonly d: PaymentServiceDeps) {
    this.now = d.now ?? (() => new Date());
  }

  /**
   * TEMPORARY (Stage 1): creates a server-priced $1.00 purchase that is already APPROVED, because
   * the mandate/approval flow does not exist yet. Removed when Stage 5 lands. The client supplies
   * no amount.
   */
  async createTemporaryPurchase(sessionId: string): Promise<Purchase> {
    const now = this.now();
    const row = await insertPurchase(this.d.db, {
      sessionId,
      itemName: TEMP_ITEM.name,
      quantity: TEMP_ITEM.quantity,
      unitAmountMinor: TEMP_ITEM.unitMinor,
      state: 'APPROVED',
      approvedAt: now,
      approvalExpiresAt: new Date(now.getTime() + this.d.approvalTtlSeconds * 1000),
    });
    return toPurchaseDto(row);
  }

  /** Route 10. Idempotent: a purchase that already has an order returns the stored order id. */
  async createPayPalOrder(
    sessionId: string,
    purchaseId: string,
    log: Logger,
  ): Promise<{ paypalOrderId: string }> {
    const { db, gateway } = this.d;
    const p = await this.load(sessionId, purchaseId);
    if (p.paypalOrderId) return { paypalOrderId: p.paypalOrderId };
    if (p.state !== 'APPROVED') throw stateConflict('Purchase is not approved for order creation.');
    if (p.approvalExpiresAt && p.approvalExpiresAt <= this.now()) {
      await transitionPurchase(db, p, 'EXPIRED');
      throw new AppError(409, 'APPROVAL_EXPIRED', 'The approval has expired.');
    }

    const { op, claimed } = await claimOperation(db, {
      purchaseId: p.id,
      kind: 'CREATE_ORDER',
      channel: 'mcp',
      mcpTool: 'create_order',
    });
    if (!claimed) {
      const again = await this.load(sessionId, purchaseId);
      if (again.paypalOrderId) return { paypalOrderId: again.paypalOrderId };
      throw stateConflict('Order creation is already in progress.');
    }

    let call;
    try {
      call = await gateway.createOrder({
        purchaseId: p.id,
        requestId: op.paypalRequestId,
        itemName: p.itemName,
        quantity: p.quantity,
        unitAmountMinor: p.unitAmountMinor,
      });
    } catch (e) {
      await finishOperation(db, op.id, failure(e));
      throw e instanceof UpstreamError ? toAppError(e) : e;
    }
    log.info(
      { purchaseId: p.id, paypalOrderId: call.data.id, ...call.trace },
      'paypal order created',
    );

    try {
      await db.transaction(async (tx) => {
        const moved = await transitionPurchase(tx as Db, p, 'ORDER_CREATED', {
          paypalOrderId: call.data.id,
          paypalStatus: call.data.status,
        });
        if (!moved) throw stateConflict('Purchase changed while creating the order.');
        await finishOperation(tx as Db, op.id, {
          status: 'SUCCEEDED',
          channel: call.trace.channel,
          mcpTool: call.trace.channel === 'mcp' ? 'create_order' : null,
          httpStatus: call.httpStatus,
          paypalDebugId: call.debugId,
        });
      });
    } catch (e) {
      // The PayPal order exists but is not linked: keep the id in the log for manual reconcile.
      log.error({ purchaseId: p.id, paypalOrderId: call.data.id }, 'order created but not stored');
      throw e;
    }
    return { paypalOrderId: call.data.id };
  }

  /** Route 11 (Stage 1: minimal G1-G3 checks, then REST capture with the stored request id). */
  async capturePayPalOrder(
    sessionId: string,
    purchaseId: string,
    paypalOrderId: string,
    log: Logger,
  ): Promise<Purchase> {
    const { db, gateway, rest } = this.d;
    const p = await this.load(sessionId, purchaseId);

    if (
      (p.state === 'CAPTURED' || p.state === 'CAPTURE_PENDING') &&
      p.paypalOrderId === paypalOrderId
    ) {
      return toPurchaseDto(p);
    }
    if (p.state !== 'ORDER_CREATED' || !p.paypalOrderId) {
      throw stateConflict('Purchase has no PayPal order ready for capture.');
    }

    // Fail closed: when the live order cannot be read, nothing is captured.
    let live;
    try {
      live = await gateway.getOrder(p.paypalOrderId);
    } catch (e) {
      throw e instanceof UpstreamError ? toAppError(e) : e;
    }
    log.info({ purchaseId: p.id, ...live.trace }, 'live order read before capture');

    const failed = minimalCaptureChecks(p, paypalOrderId, live.data);
    if (failed.length > 0) {
      await transitionPurchase(db, p, 'BLOCKED_AT_CAPTURE', {
        blockReasons: failed,
        paypalStatus: live.data.status,
      });
      throw new AppError(
        409,
        'CAPTURE_BLOCKED',
        'Capture blocked: the PayPal order does not match the approved purchase.',
        failed.map((code) => ({ code })),
      );
    }

    const capturing = await transitionPurchase(db, p, 'CAPTURING', {
      paypalStatus: live.data.status,
    });
    if (!capturing) throw stateConflict('Capture is already in progress.');

    const { op, claimed } = await claimOperation(db, {
      purchaseId: p.id,
      kind: 'CAPTURE',
      channel: 'rest',
      mcpTool: null,
    });
    if (!claimed) throw stateConflict('Capture is already in progress.');

    try {
      const res = await rest.captureOrder(p.paypalOrderId, op.paypalRequestId);
      const capture = res.data.purchase_units[0]?.payments.captures[0];
      if (!capture) throw new UpstreamError('paypal', 'error', 'capture missing');
      const next =
        capture.status === 'COMPLETED'
          ? 'CAPTURED'
          : capture.status === 'PENDING'
            ? 'CAPTURE_PENDING'
            : 'CAPTURE_FAILED';
      const done = await db.transaction(async (tx) => {
        const row = await transitionPurchase(tx as Db, capturing, next, {
          paypalCaptureId: capture.id,
          paypalStatus: res.data.status,
        });
        await finishOperation(tx as Db, op.id, {
          status: next === 'CAPTURE_FAILED' ? 'FAILED' : 'SUCCEEDED',
          httpStatus: res.httpStatus,
          paypalDebugId: res.debugId,
          errorCode: next === 'CAPTURE_FAILED' ? capture.status : undefined,
        });
        return row;
      });
      if (!done) throw stateConflict('Purchase changed during capture.');
      log.info({ purchaseId: p.id, state: done.state, paypalDebugId: res.debugId }, 'capture done');
      return toPurchaseDto(done);
    } catch (e) {
      throw await this.handleCaptureFailure(e, capturing, op.id, log);
    }
  }

  private async handleCaptureFailure(
    e: unknown,
    capturing: PurchaseRow,
    opId: string,
    log: Logger,
  ): Promise<unknown> {
    const { db } = this.d;
    if (!(e instanceof UpstreamError)) return e;
    await finishOperation(db, opId, failure(e));

    if (e.meta.issue === 'INSTRUMENT_DECLINED') {
      await transitionPurchase(db, capturing, 'ORDER_CREATED');
      return new AppError(409, 'INSTRUMENT_DECLINED', 'The payment method was declined. Retry.');
    }
    if (e.kind === 'error' && e.meta.httpStatus !== undefined && e.meta.httpStatus < 500) {
      await transitionPurchase(db, capturing, 'CAPTURE_FAILED');
      return toAppError(e);
    }
    // Timeout or 5xx: the outcome at PayPal is unknown. Stay in CAPTURING; Stage 5 reconciles.
    log.error({ purchaseId: capturing.id }, 'capture outcome unknown, left in CAPTURING');
    return toAppError(e);
  }

  private async load(sessionId: string, purchaseId: string): Promise<PurchaseRow> {
    const row = await getPurchase(this.d.db, sessionId, purchaseId);
    if (!row) throw notFound();
    return row;
  }
}

function failure(e: unknown) {
  const up = e instanceof UpstreamError ? e : undefined;
  return {
    status: 'FAILED' as const,
    httpStatus: up?.meta.httpStatus,
    paypalDebugId: up?.meta.debugId,
    errorCode: up
      ? (up.meta.issue ?? (up.kind === 'timeout' ? 'TIMEOUT' : 'UPSTREAM_ERROR'))
      : 'INTERNAL',
  };
}
