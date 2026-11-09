import type { Money } from '@intentlock/shared';

const MONEY_PATTERN = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

export function parseMoneyDecimal(value: string): bigint | null {
  const match = MONEY_PATTERN.exec(value);
  if (!match) return null;
  return BigInt(match[1] as string) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
}

export function parseUsdToMinor(value: string): bigint | null {
  return parseMoneyDecimal(value);
}

export function formatUsd(minor: bigint): string {
  if (minor < 0n) throw new RangeError('Negative money is not supported');
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export function toMoney(minor: bigint): Money {
  return { minor: minor.toString(), currency: 'USD', display: `$${formatUsd(minor)}` };
}
