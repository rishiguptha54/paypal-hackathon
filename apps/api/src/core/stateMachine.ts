import type { MandateStatusSchema, PurchaseState } from '@intentlock/shared';

export type MandateStatus =
  (typeof MandateStatusSchema.enum)[keyof typeof MandateStatusSchema.enum];

const purchaseTransitions: Record<PurchaseState, readonly PurchaseState[]> = {
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['ORDER_CREATED', 'EXPIRED', 'CANCELLED'],
  ORDER_CREATED: ['CAPTURING', 'BLOCKED_AT_CAPTURE', 'CANCELLED', 'EXPIRED'],
  CAPTURING: ['CAPTURED', 'CAPTURE_PENDING', 'CAPTURE_FAILED', 'ORDER_CREATED'],
  CAPTURED: ['REVERSED'],
  CAPTURE_PENDING: ['CAPTURED', 'CAPTURE_FAILED'],
  CAPTURE_FAILED: [],
  BLOCKED_AT_CAPTURE: [],
  CANCELLED: [],
  EXPIRED: [],
  REVERSED: [],
};

const mandateTransitions: Record<MandateStatus, readonly MandateStatus[]> = {
  DRAFT: ['CONFIRMED', 'NEEDS_CLARIFICATION'],
  NEEDS_CLARIFICATION: ['DRAFT', 'CONFIRMED'],
  CONFIRMED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export class IllegalTransition extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal state transition: ${from} -> ${to}`);
    this.name = 'IllegalTransition';
  }
}

export function canTransitionPurchase(from: PurchaseState, to: PurchaseState): boolean {
  return purchaseTransitions[from].includes(to);
}

export function transitionPurchase(from: PurchaseState, to: PurchaseState): PurchaseState {
  if (!canTransitionPurchase(from, to)) throw new IllegalTransition(from, to);
  return to;
}

export function canTransitionMandate(from: MandateStatus, to: MandateStatus): boolean {
  return mandateTransitions[from].includes(to);
}

export function transitionMandate(from: MandateStatus, to: MandateStatus): MandateStatus {
  if (!canTransitionMandate(from, to)) throw new IllegalTransition(from, to);
  return to;
}

export const PURCHASE_TRANSITIONS = purchaseTransitions;
export const MANDATE_TRANSITIONS = mandateTransitions;
