import type { Evaluation, MandateFields } from '@intentlock/shared';
import { REASON_CODE_TEMPLATES, type PolicyFinding, type ReasonCode } from '@intentlock/shared';
import type { NormalizedOffer } from './normalizeOffer';
import { formatUsd, parseMoneyDecimal } from './money';
import { normalizeDomain } from './normalizeOffer';

export const POLICY_VERSION = '1.0.0';

type Rule = (mandate: MandateFields, offer: NormalizedOffer) => PolicyFinding[];

const rules: Rule[] = [
  (m, o) => {
    if (o.unitAmountMinor === null) return [finding('PRICE_UNKNOWN')];
    const unit = BigInt(o.unitAmountMinor);
    const total = unit * BigInt(m.quantity);
    const max = parseMoneyDecimal(m.maxTotal);
    return max !== null && total > max
      ? [finding('OVER_BUDGET', { total: formatUsd(total), max: formatUsd(max) })]
      : [];
  },
  (m, o) => {
    if (!o.currency) return [finding('CURRENCY_UNKNOWN')];
    return o.currency !== m.currency
      ? [finding('CURRENCY_UNSUPPORTED', { currency: o.currency, mandateCurrency: m.currency })]
      : [];
  },
  (m, o) => {
    if (!o.merchantDomain) return [finding('MERCHANT_UNKNOWN')];
    const domain = normalizeDomain(o.merchantDomain);
    const allowed = m.allowedMerchantDomains.some((entry) => {
      const normalized = normalizeDomain(entry);
      return (
        normalized !== null &&
        domain !== null &&
        (domain === normalized || domain.endsWith(`.${normalized}`))
      );
    });
    return allowed ? [] : [finding('VENDOR_NOT_APPROVED', { domain: domain ?? o.merchantDomain })];
  },
  (m, o) => {
    if (o.recurrenceSignal === 'RECURRING' && !m.recurringAllowed) {
      return [
        finding('RECURRING_NOT_ALLOWED', {
          evidence: o.recurrenceEvidence ?? 'recurring terms',
        }),
      ];
    }
    if (o.recurrenceSignal === 'AMBIGUOUS' && !m.recurringAllowed) {
      return [
        finding('RECURRENCE_UNCLEAR', {
          evidence: o.recurrenceEvidence ?? 'unclear recurring terms',
        }),
      ];
    }
    return [];
  },
  (m, o) => {
    const text = `${o.title} ${o.brand ?? ''}`;
    const term = m.excludedTerms.find((candidate) =>
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(candidate)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(
        text,
      ),
    );
    return term ? [finding('EXCLUDED_TERM_PRESENT', { term })] : [];
  },
];

export function evaluate(
  mandate: MandateFields,
  offer: NormalizedOffer,
  policyVersion = POLICY_VERSION,
  now = new Date(),
): Evaluation {
  const findings = rules.flatMap((rule) => rule(mandate, offer));
  if (findings.length === 0) findings.push(finding('ALL_RULES_PASSED'));
  const decision = findings.some((f) => f.severity === 'BLOCKING')
    ? 'BLOCKED'
    : findings.some((f) => f.severity === 'REVIEW')
      ? 'NEEDS_REVIEW'
      : 'ALLOWED';
  return { decision, findings, policyVersion, evaluatedAt: now.toISOString() };
}

function finding(
  code: ReasonCode,
  evidence: Record<string, string | number | boolean> = {},
): PolicyFinding {
  const template = REASON_CODE_TEMPLATES[code];
  const message = template.message.replace(/\{([^}]+)\}/g, (_, key: string) =>
    String(evidence[key] ?? ''),
  );
  return { code, severity: template.severity, message, evidence };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
