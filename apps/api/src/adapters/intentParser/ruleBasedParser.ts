import { DraftMandateSchema, type ClarificationQuestion } from '@intentlock/shared';
import type { IntentParser, ParsedDraft } from './types';
import { normalizeDomain } from '../../core/normalizeOffer';

const AMOUNT_TOKEN = String.raw`(?:\$\s*)?(\d{1,9}(?:\.\d{1,2})?)\s*(?:USD|dollars?)?`;

export class RuleBasedParser implements IntentParser {
  status() {
    return 'ok' as const;
  }

  async parse(requestText: string): Promise<ParsedDraft> {
    const extractedQuantity = extractQuantity(requestText);
    const budgets = extractBudgets(requestText);
    const quantity = extractedQuantity;
    const maxTotal = budgets.length === 1 ? budgets[0] : undefined;
    const productQuery = extractProductQuery(requestText);
    const domains = extractDomains(requestText);
    const clarificationQuestions: ClarificationQuestion[] = [];

    if (quantity === undefined) {
      clarificationQuestions.push({
        field: 'quantity',
        question: 'How many items do you need? Please enter a quantity from 1 to 100.',
      });
    }
    if (maxTotal === undefined) {
      clarificationQuestions.push({
        field: 'maxTotal',
        question:
          budgets.length > 1
            ? 'Your request includes conflicting budget limits. What is the maximum total in USD?'
            : 'What is the maximum total you are willing to spend in USD?',
      });
    }
    if (domains.length === 0) {
      clarificationQuestions.push({
        field: 'allowedMerchantDomains',
        question: 'Which merchant domains are approved for this purchase?',
      });
    }

    return {
      ...DraftMandateSchema.parse({
        productQuery,
        quantity,
        maxTotal,
        currency: 'USD',
        allowedMerchantDomains: domains,
        recurringAllowed: /\b(recurring|subscription|monthly)\s+(?:is\s+)?allowed\b/i.test(
          requestText,
        ),
        excludedTerms: extractExcludedTerms(requestText),
        clarificationQuestions,
      }),
      parser: 'rule:v1',
    };
  }
}

export function extractQuantity(text: string): number | undefined {
  const match =
    /\b(?:buy|purchase|order|get|need|want)?\s*(\d{1,4})\s+(?=[\p{L}])/iu.exec(text) ??
    /\bquantity\s*(?:of|:)?\s*(\d{1,4})\b/i.exec(text);
  if (!match) return undefined;
  const quantity = Number.parseInt(match[1] as string, 10);
  return quantity >= 1 && quantity <= 100 ? quantity : undefined;
}

export function extractBudgets(text: string): string[] {
  const results: string[] = [];
  const marked = new RegExp(
    String.raw`(?:max(?:imum)?|budget|under|below|less than|up to|not more than|cap(?:ped)? at)\s*[:=]?\s*${AMOUNT_TOKEN}`,
    'gi',
  );
  for (const match of text.matchAll(marked)) {
    if (match[1]) results.push(normalizeDecimal(match[1]));
  }
  if (results.length === 0) {
    const dollar = new RegExp(String.raw`\$\s*(\d{1,9}(?:\.\d{1,2})?)`, 'g');
    for (const match of text.matchAll(dollar)) {
      if (match[1]) results.push(normalizeDecimal(match[1]));
    }
  }
  return [...new Set(results)];
}

function extractDomains(text: string): string[] {
  const domains = new Set<string>();
  const re = /\b(?:from|only\s+from|at)\s+([a-z0-9.-]+\.[a-z]{2,})\b/gi;
  for (const match of text.matchAll(re)) {
    const domain = normalizeDomain(match[1]);
    if (domain) domains.add(domain);
  }
  return [...domains].slice(0, 20);
}

function extractExcludedTerms(text: string): string[] {
  const match = /\b(?:no|exclude|excluding)\s+([a-z][a-z -]{1,39}?)(?=[,.!?;]|$)/i.exec(text);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\s+(?:or|and)\s+|,\s*/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2 && term.length <= 40)
    .slice(0, 20);
}

function extractProductQuery(text: string): string {
  let value = text
    .replace(/\b(?:buy|purchase|order|get|need|want)\b/gi, ' ')
    .replace(/\b\d{1,4}\s+(?=[\p{L}])/giu, ' ')
    .replace(
      /\b(?:max(?:imum)?|budget|under|below|less than|up to|not more than)\b[^,.!?;]*/gi,
      ' ',
    )
    .replace(/\$\s*\d{1,9}(?:\.\d{1,2})?/g, ' ')
    .replace(/\b(?:only from|from|at)\s+[a-z0-9.-]+\.[a-z]{2,}\b/gi, ' ')
    .replace(/\b(?:no|exclude|excluding)\b[^,.!?;]*/gi, ' ')
    .replace(/[,.!?;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (value.length < 2) value = text.trim();
  return value.slice(0, 200);
}

function normalizeDecimal(value: string): string {
  const [whole, fraction] = value.split('.');
  return fraction === undefined ? (whole as string) : `${whole}.${fraction.padEnd(2, '0')}`;
}
