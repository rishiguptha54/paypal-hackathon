import {
  MandateHashFieldsSchema,
  type DriftKind,
  type Finding,
  type MandateHashFields,
} from '@intentlock/shared';
import { mandateHash } from './mandateHash';
import { parseMoneyDecimal } from './money';
import { normalizeDomain } from './normalizeOffer';

export function captureGate(input: {
  purchase: {
    id: string;
    paypalOrderId: string | null;
    totalMinor: bigint;
    unitAmountMinor: bigint;
    quantity: number;
    currency: string;
    mandateHash: string | null;
    approvedAt: Date | null;
    approvalExpiresAt: Date | null;
    simulatedDrift: DriftKind | null;
  };
  requestedOrderId: string;
  live: {
    id: string;
    status: string;
    intent?: string;
    purchase_units: { custom_id?: string; amount: { value: string; currency_code: string } }[];
  };
  currentHashFields: MandateHashFields | null;
  approvedMerchantDomain: string | null;
  policyAllowed: boolean;
  now: Date;
}): Finding[] {
  const { purchase: p, live, currentHashFields: current } = input;
  const failed: Finding[] = [];
  const fail = (code: string, message: string) => {
    failed.push({ code, severity: 'BLOCKING', message, evidence: {} });
  };
  if (input.requestedOrderId !== p.paypalOrderId || live.id !== p.paypalOrderId)
    fail('ORDER_MISMATCH', 'The PayPal order does not belong to this purchase.');
  if (live.status !== 'APPROVED' || (live.intent !== undefined && live.intent !== 'CAPTURE'))
    fail('PAYPAL_NOT_APPROVED', 'The PayPal order is not approved for capture.');
  const unit = live.purchase_units[0];
  if (
    live.purchase_units.length !== 1 ||
    !unit ||
    parseMoneyDecimal(unit.amount.value) !== p.totalMinor ||
    unit.amount.currency_code !== p.currency ||
    p.simulatedDrift === 'PRICE_HIKE'
  )
    fail(
      'DRIFT_AMOUNT_MISMATCH',
      'The live order amount or currency differs from the approved purchase.',
    );
  if (!unit || unit.custom_id !== p.id)
    fail('CUSTOM_ID_MISMATCH', 'The live order purchase binding does not match.');
  const merchantChanged =
    current?.merchantDomain !== input.approvedMerchantDomain ||
    input.approvedMerchantDomain === null ||
    p.simulatedDrift === 'MERCHANT_SWAP';
  if (merchantChanged)
    fail('DRIFT_MERCHANT_MISMATCH', 'The merchant differs from the approved merchant.');
  const validHashFields =
    current &&
    MandateHashFieldsSchema.safeParse(current).success &&
    normalizeDomain(current.merchantDomain) !== null;
  if (
    !validHashFields ||
    mandateHash(current) !== p.mandateHash ||
    merchantChanged ||
    current.quantity !== p.quantity ||
    current.unitPriceMinor !== p.unitAmountMinor.toString() ||
    current.totalMinor !== p.totalMinor.toString() ||
    current.currency !== p.currency
  )
    fail('MANDATE_CHANGED', 'The protected purchase fields changed after approval.');
  if (!input.policyAllowed)
    fail('POLICY_NOW_BLOCKS', 'The current mandate and offer are no longer allowed.');
  if (
    !p.approvedAt ||
    !p.approvalExpiresAt ||
    input.now >= p.approvalExpiresAt ||
    p.simulatedDrift === 'APPROVAL_EXPIRED'
  )
    fail('APPROVAL_EXPIRED', 'The human approval is missing or expired.');
  return failed;
}
