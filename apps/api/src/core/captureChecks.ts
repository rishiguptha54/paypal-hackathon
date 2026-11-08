import { parseUsdToMinor } from './money';

export interface LiveOrderView {
  id: string;
  status: string;
  purchase_units: { amount: { currency_code: string; value: string } }[];
}

export interface StoredPurchaseView {
  paypalOrderId: string | null;
  totalMinor: bigint;
  currency: string;
}

/**
 * Stage 1 subset of the capture gate (G1-G3, architecture section 6.3).
 * Pure: returns the failed check codes; an empty list means "may capture".
 * Stage 5 replaces this with the full G1-G7 CaptureGate.
 */
export function minimalCaptureChecks(
  stored: StoredPurchaseView,
  requestedOrderId: string,
  live: LiveOrderView,
): string[] {
  const failed: string[] = [];
  if (stored.paypalOrderId !== requestedOrderId || live.id !== stored.paypalOrderId) {
    failed.push('ORDER_ID_MISMATCH');
  }
  if (live.status !== 'APPROVED') failed.push('ORDER_NOT_APPROVED');
  const unit = live.purchase_units.length === 1 ? live.purchase_units[0] : undefined;
  const liveMinor = unit ? parseUsdToMinor(unit.amount.value) : null;
  if (!unit || liveMinor !== stored.totalMinor || unit.amount.currency_code !== stored.currency) {
    failed.push('DRIFT_AMOUNT_MISMATCH');
  }
  return failed;
}
