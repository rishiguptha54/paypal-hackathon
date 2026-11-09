import { describe, expect, it } from 'vitest';
import {
  AUDIT_GENESIS,
  auditHash,
  canonicalJson,
  verifyAuditChain,
} from '../../src/core/auditHash';
import { captureGate } from '../../src/core/captureGate';
import { mandateHash } from '../../src/core/mandateHash';
import type { DriftKind, MandateHashFields } from '@intentlock/shared';

describe('UNIT-AUD-01 canonical session hash chain', () => {
  const first = {
    seq: 1n,
    type: 'MANDATE_CONFIRMED',
    payload: { z: [true, null, { b: 2, a: 1 }], a: 'chair' },
    sessionId: 'session-one',
    purchaseId: null,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    prevHash: AUDIT_GENESIS,
    entryHash: '',
  };
  first.entryHash = auditHash(first.prevHash, first);
  const second = {
    ...first,
    seq: 3n,
    purchaseId: 'purchase-one',
    type: 'PURCHASE_CREATED',
    prevHash: first.entryHash,
    entryHash: '',
  };
  second.entryHash = auditHash(second.prevHash, second);

  it('sorts nested object keys, preserves arrays and verifies an empty or intact chain', () => {
    expect(canonicalJson({ b: 2, a: [1, null] })).toBe('{"a":[1,null],"b":2}');
    expect(canonicalJson({ a: [1, null], b: 2 })).toBe('{"a":[1,null],"b":2}');
    expect(verifyAuditChain([])).toEqual({ status: 'INTACT', checked: 0 });
    expect(verifyAuditChain([first, second])).toEqual({ status: 'INTACT', checked: 2 });
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it('identifies the exact broken sequence and zero-based index', () => {
    for (const patch of [
      { payload: { changed: true } },
      { type: 'OTHER' },
      { purchaseId: 'foreign' },
      { sessionId: 'foreign' },
      { createdAt: new Date(0) },
      { prevHash: AUDIT_GENESIS },
      { entryHash: AUDIT_GENESIS },
    ]) {
      expect(verifyAuditChain([first, { ...second, ...patch }])).toEqual({
        status: 'BROKEN',
        checked: 2,
        firstBrokenSeq: '3',
        firstBrokenIndex: 1,
      });
    }
    expect(verifyAuditChain([second, first]).status).toBe('BROKEN');
  });
});

describe('CaptureGate G1–G7', () => {
  const fields: MandateHashFields = {
    mandateId: '00000000-0000-4000-8000-000000000001',
    mandateVersion: 1,
    offerId: '00000000-0000-4000-8000-000000000002',
    merchantDomain: 'shop.example',
    quantity: 1,
    unitPriceMinor: '8900',
    totalMinor: '8900',
    currency: 'USD',
    recurring: false,
  };
  function input(): Parameters<typeof captureGate>[0] {
    return {
      purchase: {
        id: 'purchase-one',
        paypalOrderId: 'ORDER123',
        totalMinor: 8900n,
        unitAmountMinor: 8900n,
        quantity: 1,
        currency: 'USD',
        mandateHash: mandateHash(fields),
        approvedAt: new Date(0),
        approvalExpiresAt: new Date(900_000),
        simulatedDrift: null,
      },
      requestedOrderId: 'ORDER123',
      live: {
        id: 'ORDER123',
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [
          { custom_id: 'purchase-one', amount: { value: '89.00', currency_code: 'USD' } },
        ],
      },
      currentHashFields: { ...fields },
      approvedMerchantDomain: 'shop.example',
      policyAllowed: true,
      now: new Date(899_999),
    };
  }
  const codes = (value: Parameters<typeof captureGate>[0]) =>
    captureGate(value).map((finding) => finding.code);

  it('accepts verified approval until (not including) the TTL boundary', () => {
    expect(captureGate(input())).toEqual([]);
    const value = input();
    value.live.intent = undefined;
    value.live.purchase_units[0]!.amount.value = '89';
    expect(captureGate(value)).toEqual([]);
    value.now = new Date(900_000);
    expect(codes(value)).toEqual(['APPROVAL_EXPIRED']);
  });

  it('runs all rules, returning every applicable failure', () => {
    const value = input();
    value.requestedOrderId = 'WRONG';
    value.live.status = 'CREATED';
    value.live.purchase_units = [];
    value.currentHashFields = null;
    value.approvedMerchantDomain = null;
    value.policyAllowed = false;
    value.purchase.approvalExpiresAt = null;
    expect(codes(value)).toEqual([
      'ORDER_MISMATCH',
      'PAYPAL_NOT_APPROVED',
      'DRIFT_AMOUNT_MISMATCH',
      'CUSTOM_ID_MISMATCH',
      'DRIFT_MERCHANT_MISMATCH',
      'MANDATE_CHANGED',
      'POLICY_NOW_BLOCKS',
      'APPROVAL_EXPIRED',
    ]);
  });

  it('detects changed order IDs, intent, currency, amount, purchase binding and multiple units', () => {
    const mutations: ((value: ReturnType<typeof input>) => void)[] = [
      (v) => {
        v.live.id = 'WRONG';
      },
      (v) => {
        v.live.intent = 'AUTHORIZE';
      },
      (v) => {
        v.live.purchase_units[0]!.amount.currency_code = 'EUR';
      },
      (v) => {
        v.live.purchase_units[0]!.amount.value = '90.00';
      },
      (v) => {
        v.live.purchase_units[0]!.custom_id = 'foreign';
      },
      (v) => {
        v.live.purchase_units.push(v.live.purchase_units[0]!);
      },
    ];
    for (const mutate of mutations) {
      const value = input();
      mutate(value);
      expect(codes(value).length).toBeGreaterThan(0);
    }
  });

  it('invalidates changed or malformed protected fields and missing human approval', () => {
    for (const patch of [
      { merchantDomain: 'other.example' },
      { merchantDomain: 'invalid_domain' },
      { currency: '' },
      { totalMinor: '9000' },
      { quantity: 2 },
      { recurring: true },
    ]) {
      const value = input();
      value.currentHashFields = { ...fields, ...patch };
      expect(codes(value)).toContain('MANDATE_CHANGED');
    }
    for (const patch of [
      { quantity: 2 },
      { unitAmountMinor: 9000n },
      { totalMinor: 9000n },
      { currency: 'EUR' },
    ]) {
      const value = input();
      Object.assign(value.purchase, patch);
      expect(codes(value)).toContain('MANDATE_CHANGED');
    }
    const value = input();
    value.purchase.approvedAt = null;
    expect(codes(value)).toContain('APPROVAL_EXPIRED');
  });

  it.each<DriftKind>(['PRICE_HIKE', 'MERCHANT_SWAP', 'APPROVAL_EXPIRED'])(
    '%s can only add gate failures',
    (kind) => {
      const value = input();
      value.policyAllowed = false;
      const before = codes(value);
      value.purchase.simulatedDrift = kind;
      const after = codes(value);
      expect(after).toEqual(expect.arrayContaining(before));
      expect(after.length).toBeGreaterThan(before.length);
    },
  );
});
