import type { Money } from '@intentlock/shared';

/** Stage 1 subset of core/money: bigint minor units only, USD only. Stage 2 adds strict parsing. */
export function formatUsd(minor: bigint): string {
  if (minor < 0n) throw new RangeError('Negative money is not supported');
  const cents = (minor % 100n).toString().padStart(2, '0');
  return `${(minor / 100n).toString()}.${cents}`;
}

export function toMoney(minor: bigint): Money {
  return { minor: minor.toString(), currency: 'USD', display: `$${formatUsd(minor)}` };
}

/** Strict decimal-string parse ("1", "1.0", "1.00"); anything else is rejected, never rounded. */
export function parseUsdToMinor(value: string): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) return null;
  return BigInt(m[1] as string) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}
