import type { Finding } from './index';

export const REASON_CODE_TEMPLATES = {
  ALL_RULES_PASSED: { severity: 'INFO', message: 'All mandate rules passed.' },
  OVER_BUDGET: { severity: 'BLOCKING', message: 'Total {total} exceeds the {max} limit.' },
  VENDOR_NOT_APPROVED: { severity: 'BLOCKING', message: '{domain} is not an approved merchant.' },
  RECURRING_NOT_ALLOWED: {
    severity: 'BLOCKING',
    message: "Offer includes recurring terms ('{evidence}') you did not authorize.",
  },
  CURRENCY_UNSUPPORTED: {
    severity: 'BLOCKING',
    message: 'Offer is priced in {currency}; mandate allows {mandateCurrency}.',
  },
  EXCLUDED_TERM_PRESENT: {
    severity: 'BLOCKING',
    message: "Offer matches excluded term '{term}'.",
  },
  PRICE_UNKNOWN: { severity: 'REVIEW', message: 'Price could not be verified.' },
  CURRENCY_UNKNOWN: { severity: 'REVIEW', message: 'Currency could not be verified.' },
  MERCHANT_UNKNOWN: { severity: 'REVIEW', message: 'Merchant could not be verified.' },
  RECURRENCE_UNCLEAR: {
    severity: 'REVIEW',
    message: "Offer may include recurring terms ('{evidence}'); review before buying.",
  },
} as const;

export type ReasonCode = keyof typeof REASON_CODE_TEMPLATES;
export type Severity = 'BLOCKING' | 'REVIEW' | 'INFO';
export type PolicyFinding = Finding & { code: ReasonCode };
