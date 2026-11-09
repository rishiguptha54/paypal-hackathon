import { createHash } from 'node:crypto';
import { MandateHashFieldsSchema, type MandateHashFields } from '@intentlock/shared';
import { normalizeDomain } from './normalizeOffer';

const HASH_KEYS = [
  'currency',
  'mandateId',
  'mandateVersion',
  'merchantDomain',
  'offerId',
  'quantity',
  'recurring',
  'totalMinor',
  'unitPriceMinor',
] as const;

export function canonicalMandateFields(input: MandateHashFields): string {
  const fields = MandateHashFieldsSchema.parse(input);
  const merchantDomain = normalizeDomain(fields.merchantDomain);
  if (!merchantDomain) throw new TypeError('Invalid merchant domain in mandate hash');
  const canonical = { ...fields, merchantDomain };
  return `{${HASH_KEYS.map((key) => `${JSON.stringify(key)}:${JSON.stringify(canonical[key])}`).join(',')}}`;
}

export function mandateHash(input: MandateHashFields): string {
  return createHash('sha256').update(canonicalMandateFields(input)).digest('hex');
}
