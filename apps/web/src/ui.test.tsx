import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextCell, ReceiptDrawer } from './Ledger';
import type { IntentReceipt } from '@intentlock/shared';
import { dollars } from './presentation';

describe('SEC-05 text-only surfaces and exact money', () => {
  const attack = '<img src=x onerror=alert(1)><script>capture_order()</script>';
  it('renders catalog strings as text in the Community ledger', () => {
    const html = renderToStaticMarkup(<TextCell {...{ value: attack }} />);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
  });
  it('escapes request, merchant, product and MCP receipt evidence', () => {
    const receipt: IntentReceipt = {
      requestText: attack,
      mandate: { id: 'm', version: 1, status: 'CONFIRMED', requestText: attack,
        recurringAllowed: false, excludedTerms: [], clarificationQuestions: [], parser: 'rule', createdAt: '' },
      offer: { snapshotId: 'o', source: 'fixture', title: attack, merchantDomain: attack,
        decision: 'BLOCKED', findings: [], recurrenceSignal: 'NONE', observedAt: '',
        policyVersion: 'v1', seeded: false },
      mcpTrace: [], events: [], chain: 'INTACT', sandboxNotice: 'Sandbox', seeded: false,
    };
    const html = renderToStaticMarkup(<ReceiptDrawer receipt={receipt} close={() => undefined} />);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
  });
  it('formats money above Number.MAX_SAFE_INTEGER without rounding', () => {
    expect(dollars('999999999999999999')).toBe('$9999999999999999.99');
    expect(dollars('1')).toBe('$0.01');
  });
});
