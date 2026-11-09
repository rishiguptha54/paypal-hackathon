import { ApiError } from './api';

export function describe(error: unknown): string {
  return error instanceof ApiError
    ? `${error.message} (${error.code}${error.requestId ? `, ${error.requestId}` : ''})`
    : 'The request could not be completed. Please retry.';
}

export function dollars(minor: string): string {
  const value = BigInt(minor);
  return `$${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
