export type ErrorDetail = Record<string, unknown>;

/** Safe-to-return errors. `message` and `details` must never contain secrets or stack data. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found.');
export const stateConflict = (message: string, details: ErrorDetail[] = []) =>
  new AppError(409, 'STATE_CONFLICT', message, details);

export type UpstreamProvider = 'ai' | 'channel3' | 'paypal_mcp' | 'paypal';

/** Raised by adapters. Routes map it to 502 / 504 with only the provider name exposed. */
export class UpstreamError extends Error {
  constructor(
    readonly provider: UpstreamProvider,
    readonly kind: 'error' | 'timeout',
    message: string,
    readonly meta: { httpStatus?: number; debugId?: string; issue?: string } = {},
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export const toAppError = (e: UpstreamError): AppError =>
  e.kind === 'timeout'
    ? new AppError(504, 'UPSTREAM_TIMEOUT', 'The payment provider timed out.', [
        { provider: e.provider },
      ])
    : new AppError(502, 'UPSTREAM_ERROR', 'The payment provider returned an error.', [
        { provider: e.provider },
      ]);
