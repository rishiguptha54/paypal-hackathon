import type { ZodType } from 'zod';
import { UpstreamError } from '../../errors';
import type { Logger } from '../../logger';
import { buildCreateOrderBody } from './orderBody';
import {
  CaptureResponseSchema,
  CreatedOrderSchema,
  PayPalErrorBodySchema,
  PayPalOrderSchema,
  TokenResponseSchema,
  type CaptureResponse,
  type CreatedOrder,
  type CreateOrderInput,
  type PayPalOrder,
  type RestResult,
} from './schemas';

/** Hard-coded on purpose: this app only ever talks to the Sandbox. */
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
export const PAYPAL_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export interface AccessToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface PayPalRestOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  logger?: Logger;
}

export class PayPalRestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private cached?: AccessToken;
  private inflight?: Promise<AccessToken>;

  constructor(private readonly opts: PayPalRestOptions) {
    this.baseUrl = opts.baseUrl ?? PAYPAL_SANDBOX_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? PAYPAL_TIMEOUT_MS;
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  /** Cached client-credentials token; concurrent callers share one in-flight request. */
  async getAccessToken(): Promise<AccessToken> {
    if (this.cached && this.cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > this.now()) {
      return this.cached;
    }
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<AccessToken> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.send('/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    const parsed = this.parse(TokenResponseSchema, res);
    this.cached = {
      token: parsed.data.access_token,
      expiresAt: this.now() + parsed.data.expires_in * 1000,
    };
    return this.cached;
  }

  /** Auth probe for /api/health. */
  async isReachable(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  async createOrder(input: CreateOrderInput, requestId: string): Promise<RestResult<CreatedOrder>> {
    const res = await this.authed('POST', '/v2/checkout/orders', requestId, {
      body: JSON.stringify(buildCreateOrderBody(input)),
    });
    return this.parse(CreatedOrderSchema, res);
  }

  async getOrder(orderId: string): Promise<RestResult<PayPalOrder>> {
    const res = await this.authed('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    return this.parse(PayPalOrderSchema, res);
  }

  /** Capture always reuses the stored request id so a timeout-then-retry cannot double capture. */
  async captureOrder(orderId: string, requestId: string): Promise<RestResult<CaptureResponse>> {
    const res = await this.authed(
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      requestId,
      { body: '{}' },
    );
    return this.parse(CaptureResponseSchema, res);
  }

  private async authed(
    method: 'GET' | 'POST',
    path: string,
    requestId?: string,
    init: { body?: string } = {},
  ) {
    const { token } = await this.getAccessToken();
    return this.send(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(method === 'POST' && { 'Content-Type': 'application/json' }),
        ...(requestId && { 'PayPal-Request-Id': requestId }),
      },
      body: init.body,
    });
  }

  private async send(path: string, init: RequestInit) {
    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      this.opts.logger?.warn(
        { paypal_ms: this.now() - started, timedOut },
        'paypal rest request failed',
      );
      throw new UpstreamError(
        'paypal',
        timedOut ? 'timeout' : 'error',
        timedOut ? 'PayPal request timed out' : 'PayPal request failed',
      );
    }

    const debugId = res.headers.get('paypal-debug-id') ?? undefined;
    const text = await res.text();
    this.opts.logger?.info(
      { paypal_ms: this.now() - started, paypalDebugId: debugId, httpStatus: res.status },
      'paypal rest call',
    );

    if (!res.ok) {
      throw new UpstreamError('paypal', 'error', `PayPal returned HTTP ${res.status}`, {
        httpStatus: res.status,
        debugId,
        issue: extractIssue(text),
      });
    }
    return { text, httpStatus: res.status, debugId };
  }

  private parse<T>(
    schema: ZodType<T>,
    res: { text: string; httpStatus: number; debugId?: string },
  ): RestResult<T> {
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      json = undefined;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new UpstreamError('paypal', 'error', 'PayPal response failed validation', {
        httpStatus: res.httpStatus,
        debugId: res.debugId,
      });
    }
    return { data: parsed.data, httpStatus: res.httpStatus, debugId: res.debugId };
  }
}

function extractIssue(text: string): string | undefined {
  try {
    const body = PayPalErrorBodySchema.safeParse(JSON.parse(text));
    return body.success ? (body.data.details?.[0]?.issue ?? body.data.name) : undefined;
  } catch {
    return undefined;
  }
}
