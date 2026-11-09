import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger';
import {
  GeminiIntentParser,
  type GeminiGenerate,
} from '../../src/adapters/intentParser/geminiParser';
import { RuleBasedParser } from '../../src/adapters/intentParser/ruleBasedParser';

const logger = createLogger({ level: 'silent' });

describe('RuleBasedParser', () => {
  const parser = new RuleBasedParser();

  it('extracts explicit quantity, budget and merchant without guessing', async () => {
    const result = await parser.parse(
      'Buy 2 ergonomic chairs for max $100 from northstar-office.example',
    );
    expect(result.quantity).toBe(2);
    expect(result.maxTotal).toBe('100');
    expect(result.allowedMerchantDomains).toEqual(['northstar-office.example']);
  });

  it('asks for every required value omitted by the user', async () => {
    const result = await parser.parse('ergonomic desk chair');
    expect(result.quantity).toBeUndefined();
    expect(result.maxTotal).toBeUndefined();
    expect(result.clarificationQuestions.map((question) => question.field)).toEqual([
      'quantity',
      'maxTotal',
      'allowedMerchantDomains',
    ]);
  });

  it('does not silently choose between conflicting budget values', async () => {
    const result = await parser.parse('Buy 1 chair for max $50 and max $80 from example.com');
    expect(result.maxTotal).toBeUndefined();
    expect(result.clarificationQuestions.some((question) => question.field === 'maxTotal')).toBe(
      true,
    );
  });
});

describe('GeminiIntentParser', () => {
  const response = {
    productQuery: 'desk chair',
    quantity: 99,
    maxTotal: '999.99',
    currency: 'USD',
    allowedMerchantDomains: [],
    recurringAllowed: false,
    excludedTerms: [],
    clarificationQuestions: [],
  };

  it('sends only request text and overrides guessed quantity and budget with deterministic evidence', async () => {
    let receivedText = '';
    let callCount = 0;
    const generate: GeminiGenerate = async (params) => {
      callCount += 1;
      receivedText = params.contents;
      return { text: JSON.stringify(response) };
    };
    const parser = new GeminiIntentParser({
      apiKey: 'test-key',
      model: 'test-model',
      logger,
      generate,
    });
    const requestText = 'I would like to buy a desk chair';
    const result = await parser.parse(requestText);
    expect(callCount).toBe(1);
    expect(receivedText).toBe(requestText);
    expect(result.quantity).toBeUndefined();
    expect(result.maxTotal).toBeUndefined();
    expect(result.clarificationQuestions.map((question) => question.field)).toEqual(
      expect.arrayContaining(['quantity', 'maxTotal']),
    );
    expect(parser.status()).toBe('ok');
  });

  it('accepts deterministic quantity and budget when explicitly present', async () => {
    const parser = new GeminiIntentParser({
      apiKey: 'test-key',
      model: 'test-model',
      logger,
      generate: async () => ({ text: JSON.stringify(response) }),
    });
    const result = await parser.parse('Buy 3 desk chairs for max $250 from example.com');
    expect(result.quantity).toBe(3);
    expect(result.maxTotal).toBe('250');
  });

  it('revalidates strict JSON and falls back on malformed model output', async () => {
    const parser = new GeminiIntentParser({
      apiKey: 'test-key',
      model: 'test-model',
      logger,
      generate: async () => ({ text: JSON.stringify({ ...response, unexpected: true }) }),
    });
    const result = await parser.parse('Buy 1 chair for max $50 from example.com');
    expect(result.parser).toBe('rule:v1');
    expect(result.quantity).toBe(1);
    expect(result.maxTotal).toBe('50');
    expect(parser.status()).toBe('degraded');
  });

  it('falls back after a timeout and never fails open', async () => {
    const parser = new GeminiIntentParser({
      apiKey: 'test-key',
      model: 'test-model',
      logger,
      generate: async () => {
        const error = new Error('timeout');
        error.name = 'TimeoutError';
        throw error;
      },
    });
    const result = await parser.parse('desk chair');
    expect(result.quantity).toBeUndefined();
    expect(result.maxTotal).toBeUndefined();
    expect(parser.status()).toBe('degraded');
  });
});
