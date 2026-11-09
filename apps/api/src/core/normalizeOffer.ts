import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { parseMoneyDecimal } from './money';

export type RecurrenceSignal = 'NONE' | 'RECURRING' | 'AMBIGUOUS';

export interface RawOffer {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  brand?: unknown;
  brands?: unknown;
  merchantName?: unknown;
  retailer?: unknown;
  domain?: unknown;
  merchantDomain?: unknown;
  url?: unknown;
  offerUrl?: unknown;
  price?: unknown;
  currency?: unknown;
  availability?: unknown;
  recurrence?: unknown;
}

export interface NormalizedOffer {
  sourceProductId: string;
  title: string;
  brand: string | null;
  merchantName: string | null;
  merchantDomain: string | null;
  offerUrl: string | null;
  unitAmountMinor: string | null;
  currency: string | null;
  recurrenceSignal: RecurrenceSignal;
  recurrenceEvidence: string | null;
  rawSha256: string;
}

export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^www\./i, '');
  if (!trimmed || trimmed.length > 253 || /[/:@?#\\\s]/.test(trimmed)) return null;
  const ascii = domainToASCII(trimmed).toLowerCase();
  if (!ascii || ascii.length > 253 || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(ascii)) return null;
  if (
    ascii
      .split('.')
      .some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))
  ) {
    return null;
  }
  return ascii;
}

export function normalizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeOffer(raw: RawOffer): NormalizedOffer {
  const rawSha256 = createHash('sha256').update(stableJson(raw)).digest('hex');
  const title = text(raw.title) ?? text(raw.name) ?? '';
  const brand = extractBrand(raw.brand ?? raw.brands);
  const sourceProductId =
    text(raw.id) ?? createHash('sha256').update(`${title}|${rawSha256}`).digest('hex').slice(0, 24);
  const parsedAmount = decimalValue(raw.price);
  const amount = parsedAmount !== null && BigInt(parsedAmount) > 0n ? parsedAmount : null;
  const recurrence = detectRecurrence(
    [title, text(raw.description), text(raw.recurrence)].filter(Boolean).join(' '),
  );
  return {
    sourceProductId,
    title: title.slice(0, 300),
    brand,
    merchantName: text(raw.merchantName) ?? text(raw.retailer),
    merchantDomain: normalizeDomain(raw.domain ?? raw.merchantDomain),
    offerUrl: normalizeHttpsUrl(raw.url ?? raw.offerUrl),
    unitAmountMinor: amount,
    currency: normalizeCurrency(raw.currency ?? currencyOf(raw.price)),
    recurrenceSignal: recurrence.signal,
    recurrenceEvidence: recurrence.evidence,
    rawSha256,
  };
}

export function detectRecurrence(textValue: string): {
  signal: RecurrenceSignal;
  evidence: string | null;
} {
  const strong =
    /\b(?:subscription|subscribe|monthly|auto[\s-]?renew(?:al)?|membership)\b|\/\s*mo\b/i.exec(
      textValue,
    );
  if (strong) return { signal: 'RECURRING', evidence: strong[0].toLowerCase() };
  const weak = /\b(?:annual|yearly|plan|renewal|per\s+year)\b/i.exec(textValue);
  if (weak) return { signal: 'AMBIGUOUS', evidence: weak[0].toLowerCase() };
  return { signal: 'NONE', evidence: null };
}

function decimalValue(value: unknown): string | null {
  let decimal: string | undefined;
  if (typeof value === 'string') decimal = value;
  else if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    decimal = String(value);
  else if (value && typeof value === 'object') {
    const p = value as { value?: unknown; amount?: unknown; price?: unknown };
    if (typeof p.value === 'string') decimal = p.value;
    else if (typeof p.amount === 'string') decimal = p.amount;
    else if (typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0) {
      decimal = String(p.price);
    }
  }
  const minor = decimal === undefined ? null : parseMoneyDecimal(decimal);
  return minor === null ? null : minor.toString();
}

function currencyOf(value: unknown): unknown {
  return value && typeof value === 'object'
    ? (value as { currency?: unknown }).currency
    : undefined;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function extractBrand(value: unknown): string | null {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return text(first);
    if (first && typeof first === 'object') return text((first as { name?: unknown }).name);
  }
  return value && typeof value === 'object' ? text((value as { name?: unknown }).name) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(',')}}`;
}
