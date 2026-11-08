import { formatUsd } from '../../core/money';
import type { CreateOrderInput } from './schemas';

const ITEM_NAME_MAX = 127;

/** Orders v2 body from API contract section 6; every value comes from the stored purchase. */
export function buildCreateOrderBody(input: CreateOrderInput) {
  const unit = formatUsd(input.unitAmountMinor);
  const total = formatUsd(input.unitAmountMinor * BigInt(input.quantity));
  return {
    intent: 'CAPTURE' as const,
    purchase_units: [
      {
        reference_id: input.purchaseId,
        custom_id: input.purchaseId,
        invoice_id: input.purchaseId,
        description: 'IntentLock sandbox test order',
        amount: {
          currency_code: 'USD',
          value: total,
          breakdown: { item_total: { currency_code: 'USD', value: total } },
        },
        items: [
          {
            name: input.itemName.slice(0, ITEM_NAME_MAX),
            quantity: String(input.quantity),
            category: 'PHYSICAL_GOODS',
            unit_amount: { currency_code: 'USD', value: unit },
          },
        ],
      },
    ],
  };
}

export type CreateOrderBody = ReturnType<typeof buildCreateOrderBody>;
