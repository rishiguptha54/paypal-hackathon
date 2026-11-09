import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MandateFields } from '@intentlock/shared';
import { formatUsd, parseMoneyDecimal, parseUsdToMinor, toMoney } from '../../src/core/money';
import { mandateHash, canonicalMandateFields } from '../../src/core/mandateHash';
import { normalizeDomain, normalizeOffer, normalizeHttpsUrl } from '../../src/core/normalizeOffer';
import { evaluate } from '../../src/core/policy';
import {
  canTransitionMandate,
  canTransitionPurchase,
  MANDATE_TRANSITIONS,
  PURCHASE_TRANSITIONS,
  transitionMandate,
  transitionPurchase,
} from '../../src/core/stateMachine';

const fields: MandateFields = {
  productQuery: 'desk chair',
  quantity: 1,
  maxTotal: '100.00',
  currency: 'USD',
  allowedMerchantDomains: ['example.com'],
  recurringAllowed: false,
  excludedTerms: ['refurbished'],
};

function offer(overrides: Parameters<typeof normalizeOffer>[0] = {}) {
  return normalizeOffer({
    id: 'item-1',
    title: 'Desk chair',
    domain: 'shop.example.com',
    url: 'https://shop.example.com/chair',
    price: { value: '80.00', currency: 'USD' },
    ...overrides,
  });
}

describe('money', () => {
  it('parses strict decimal USD values into bigint minor units', () => {
    expect(parseMoneyDecimal('0')).toBe(0n);
    expect(parseMoneyDecimal('1.2')).toBe(120n);
    expect(parseMoneyDecimal('999999999.99')).toBe(99_999_999_999n);
    expect(parseMoneyDecimal('1.234')).toBeNull();
    expect(parseMoneyDecimal('-1')).toBeNull();
    expect(parseMoneyDecimal('1e2')).toBeNull();
    expect(parseMoneyDecimal(' 1.00')).toBeNull();
    expect(formatUsd(120n)).toBe('1.20');
    expect(() => formatUsd(-1n)).toThrow(RangeError);
    expect(parseUsdToMinor('0.01')).toBe(1n);
    expect(toMoney(120n)).toEqual({ minor: '120', currency: 'USD', display: '$1.20' });
  });
});

describe('offer normalization', () => {
  it('normalizes IDNA domains, accepts HTTPS only, and classifies recurrence', () => {
    expect(normalizeDomain('WWW.BÜCHER.example')).toBe('xn--bcher-kva.example');
    expect(normalizeDomain('-bad.example')).toBeNull();
    expect(normalizeDomain('example.com:443')).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('a'.repeat(254))).toBeNull();
    expect(normalizeDomain('a..example')).toBeNull();
    expect(normalizeHttpsUrl('https://user:pass@example.com/item')).toBeNull();
    expect(normalizeHttpsUrl('http://example.com/item')).toBeNull();
    expect(normalizeHttpsUrl(undefined)).toBeNull();
    expect(normalizeHttpsUrl('not a url')).toBeNull();
    expect(normalizeHttpsUrl('https://example.com/item')).toBe('https://example.com/item');
    expect(offer({ title: 'Monthly subscription' }).recurrenceSignal).toBe('RECURRING');
    expect(offer({ title: 'Annual protection plan' }).recurrenceSignal).toBe('AMBIGUOUS');
    expect(offer({ title: 'One-time desk chair' }).recurrenceSignal).toBe('NONE');
    expect(offer({ title: 'Auto-renewal membership' }).recurrenceSignal).toBe('RECURRING');
    expect(offer({ title: 'Seats per year' }).recurrenceSignal).toBe('AMBIGUOUS');
  });

  it('keeps missing prices and invalid URLs as unknown values', () => {
    const result = offer({
      price: 'unavailable',
      url: 'javascript:alert(1)',
      domain: 'invalid_domain',
    });
    expect(result.unitAmountMinor).toBeNull();
    expect(result.offerUrl).toBeNull();
    expect(result.merchantDomain).toBeNull();
    expect(result.rawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(offer({ price: { value: '0.00', currency: 'USD' } }).unitAmountMinor).toBeNull();
  });

  it('normalizes alternative provider fields and hashes generated identities stably', () => {
    const raw = {
      name: 'Chair'.padEnd(305, '!'),
      brands: [{ name: ' Seatwell ' }],
      retailer: ' Shop ',
      merchantDomain: 'www.shop.example',
      offerUrl: 'https://shop.example/item',
      price: { amount: '12.3', currency: ' usd ' },
      recurrence: 'billed yearly',
    };
    const result = normalizeOffer(raw);
    expect(result.sourceProductId).toHaveLength(24);
    expect(result.title).toHaveLength(300);
    expect(result.brand).toBe('Seatwell');
    expect(result.merchantName).toBe('Shop');
    expect(result.merchantDomain).toBe('shop.example');
    expect(result.offerUrl).toBe('https://shop.example/item');
    expect(result.unitAmountMinor).toBe('1230');
    expect(result.currency).toBe('USD');
    expect(result.recurrenceSignal).toBe('AMBIGUOUS');
    expect(result.rawSha256).toBe(normalizeOffer({ ...raw }).rawSha256);

    expect(normalizeOffer({ brand: 'Seatwell', currency: 'USD', price: 5 }).unitAmountMinor).toBe(
      '500',
    );
    expect(normalizeOffer({ brand: ['Seatwell'], domain: 'shop.example' }).brand).toBe('Seatwell');
    expect(normalizeOffer({ brands: [{ name: 'Seatwell' }] }).brand).toBe('Seatwell');
    expect(normalizeOffer({ brand: { name: 'Seatwell' } }).brand).toBe('Seatwell');
    expect(normalizeOffer({ brand: 12, brands: [] }).brand).toBeNull();
    expect(normalizeOffer({ price: { price: 12, currency: 'USD' } }).unitAmountMinor).toBe('1200');
    expect(normalizeOffer({ price: -1 }).unitAmountMinor).toBeNull();
    expect(normalizeOffer({ price: Number.NaN }).unitAmountMinor).toBeNull();
    expect(normalizeOffer({ price: 1e-8 }).unitAmountMinor).toBeNull();
    expect(normalizeOffer({ price: '12.00', currency: 'US' }).currency).toBeNull();
    expect(normalizeOffer({ id: 5, title: 9, name: 'fallback name' }).title).toBe('fallback name');
  });
});

describe('policy pipeline', () => {
  it('runs every rule and blocks if any blocking finding exists', () => {
    const result = evaluate(
      { ...fields, excludedTerms: ['refurbished'] },
      offer({
        title: 'Refurbished recurring monthly desk chair',
        domain: 'lookalike-example.com',
        price: { value: '150.00', currency: 'EUR' },
      }),
    );
    expect(result.decision).toBe('BLOCKED');
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'OVER_BUDGET',
      'CURRENCY_UNSUPPORTED',
      'VENDOR_NOT_APPROVED',
      'RECURRING_NOT_ALLOWED',
      'EXCLUDED_TERM_PRESENT',
    ]);
  });

  it('reports all unknown or ambiguous values for review', () => {
    const result = evaluate(
      fields,
      offer({
        title: 'Annual plan',
        domain: undefined,
        url: undefined,
        price: undefined,
        currency: undefined,
      }),
    );
    expect(result.decision).toBe('NEEDS_REVIEW');
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'PRICE_UNKNOWN',
      'CURRENCY_UNKNOWN',
      'MERCHANT_UNKNOWN',
      'RECURRENCE_UNCLEAR',
    ]);
  });

  it('uses the exact total threshold for generated amounts (UNIT-POL-05)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (quantity, unit, maximum) => {
          const policy = evaluate(
            { ...fields, quantity, maxTotal: formatUsd(BigInt(maximum)) },
            offer({ price: { value: formatUsd(BigInt(unit)), currency: 'USD' } }),
          );
          expect(policy.findings.some((f) => f.code === 'OVER_BUDGET')).toBe(
            BigInt(quantity) * BigInt(unit) > BigInt(maximum),
          );
        },
      ),
      { numRuns: 250 },
    );
  });

  it('accepts only exact or true subdomains of allowed merchants (UNIT-POL-06)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,10}$/), (subdomain) => {
        const result = evaluate(fields, offer({ domain: `${subdomain}.example.com` }));
        expect(result.findings.some((f) => f.code === 'VENDOR_NOT_APPROVED')).toBe(false);
      }),
      { numRuns: 100 },
    );
    expect(evaluate(fields, offer({ domain: 'example.com.attacker.test' })).decision).toBe(
      'BLOCKED',
    );
  });

  it('allows a compliant offer', () => {
    expect(evaluate(fields, offer()).decision).toBe('ALLOWED');
  });

  it('allows recurring terms only when explicitly permitted and handles invalid domains as unknown', () => {
    const recurring = offer({ title: 'Monthly chair' });
    expect(evaluate({ ...fields, recurringAllowed: true }, recurring).decision).toBe('ALLOWED');
    const invalidDomain = evaluate(fields, offer({ domain: 'bad_domain' }));
    expect(invalidDomain.findings.map((finding) => finding.code)).toContain('MERCHANT_UNKNOWN');
    const invalidAllowed = evaluate(
      { ...fields, allowedMerchantDomains: ['bad_domain'] },
      offer({ domain: 'shop.example.com' }),
    );
    expect(invalidAllowed.findings.map((finding) => finding.code)).toContain('VENDOR_NOT_APPROVED');
  });
});

describe('mandate hash', () => {
  const hashFields = {
    mandateId: '00000000-0000-4000-8000-000000000001',
    mandateVersion: 2,
    offerId: '00000000-0000-4000-8000-000000000002',
    merchantDomain: 'WWW.Example.com',
    quantity: 3,
    unitPriceMinor: '1250',
    totalMinor: '3750',
    currency: 'USD',
    recurring: false,
  };

  it('hashes the canonical nine protected fields (UNIT-HASH-01)', () => {
    const canonical =
      '{"currency":"USD","mandateId":"00000000-0000-4000-8000-000000000001","mandateVersion":2,"merchantDomain":"example.com","offerId":"00000000-0000-4000-8000-000000000002","quantity":3,"recurring":false,"totalMinor":"3750","unitPriceMinor":"1250"}';
    expect(canonicalMandateFields(hashFields)).toBe(canonical);
    expect(mandateHash(hashFields)).toBe(createHash('sha256').update(canonical).digest('hex'));
    expect(mandateHash(hashFields)).toBe(
      '915d105a5d20ae96e543220f42f90173de8f3a1190108ae72a2a353092a40d28',
    );
    expect(() =>
      canonicalMandateFields({ ...hashFields, merchantDomain: 'invalid_domain' }),
    ).toThrow(TypeError);
    expect(() => canonicalMandateFields({ ...hashFields, quantity: 0 })).toThrow();
  });
});

describe('state machine', () => {
  it('matches every declared purchase and mandate transition', () => {
    for (const [from, toStates] of Object.entries(PURCHASE_TRANSITIONS)) {
      for (const to of Object.keys(PURCHASE_TRANSITIONS)) {
        expect(
          canTransitionPurchase(
            from as keyof typeof PURCHASE_TRANSITIONS,
            to as keyof typeof PURCHASE_TRANSITIONS,
          ),
        ).toBe(toStates.includes(to as never));
      }
    }
    for (const [from, toStates] of Object.entries(MANDATE_TRANSITIONS)) {
      for (const to of Object.keys(MANDATE_TRANSITIONS)) {
        expect(
          canTransitionMandate(
            from as keyof typeof MANDATE_TRANSITIONS,
            to as keyof typeof MANDATE_TRANSITIONS,
          ),
        ).toBe(toStates.includes(to as never));
      }
    }
    expect(transitionPurchase('APPROVED', 'ORDER_CREATED')).toBe('ORDER_CREATED');
    expect(() => transitionPurchase('CANCELLED', 'APPROVED')).toThrow();
    expect(transitionMandate('CONFIRMED', 'SUPERSEDED')).toBe('SUPERSEDED');
    expect(() => transitionMandate('SUPERSEDED', 'CONFIRMED')).toThrow();
  });
});
