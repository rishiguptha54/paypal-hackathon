export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export type CaptureMode = 'COMPLETED' | 'PENDING' | 'DECLINE' | 'TIMEOUT' | 'ERROR_500';

/** Minimal PayPal Sandbox double behind a fetch-compatible function. */
export class FakePayPal {
  calls: FakeCall[] = [];
  orders = new Map<string, { total: string; status: string }>();
  captureMode: CaptureMode = 'COMPLETED';
  /** Overrides the amount GET /orders reports (simulates drift at PayPal). */
  liveAmountOverride?: string;
  tokenCalls = 0;
  /** Test hook: return a Response to short-circuit, or undefined to fall through. */
  intercept?: (url: string, init?: RequestInit) => Response | undefined;
  private seq = 0;

  fetch: typeof fetch = async (input, init) => {
    const hijacked = this.intercept?.(String(input), init);
    if (hijacked) return hijacked;
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? safeJson(init.body) : undefined;
    this.calls.push({ method, path: url.pathname, headers, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json', 'paypal-debug-id': 'dbg-fake-1' },
      });

    if (url.pathname === '/v1/oauth2/token') {
      this.tokenCalls++;
      return json(200, { access_token: 'fake-token', token_type: 'Bearer', expires_in: 32400 });
    }
    if (method === 'POST' && url.pathname === '/v2/checkout/orders') {
      const id = `FAKEORDER${String(++this.seq).padStart(8, '0')}`;
      const total = (body as { purchase_units: { amount: { value: string } }[] }).purchase_units[0]
        ?.amount.value as string;
      this.orders.set(id, { total, status: 'CREATED' });
      return json(201, { id, status: 'CREATED', links: [] });
    }
    const m = /^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/.exec(url.pathname);
    const order = m?.[1] ? this.orders.get(m[1]) : undefined;
    if (m && !order) return json(404, { name: 'RESOURCE_NOT_FOUND' });
    if (m && order && method === 'GET') {
      return json(200, {
        id: m[1],
        status: order.status,
        intent: 'CAPTURE',
        purchase_units: [
          { amount: { currency_code: 'USD', value: this.liveAmountOverride ?? order.total } },
        ],
      });
    }
    if (m && order && method === 'POST' && m[2]) {
      if (this.captureMode === 'TIMEOUT') throw new DOMException('timed out', 'TimeoutError');
      if (this.captureMode === 'ERROR_500') return json(500, { name: 'INTERNAL_SERVER_ERROR' });
      if (this.captureMode === 'DECLINE') {
        return json(422, {
          name: 'UNPROCESSABLE_ENTITY',
          details: [{ issue: 'INSTRUMENT_DECLINED' }],
        });
      }
      const status = this.captureMode;
      return json(201, {
        id: m[1],
        status,
        purchase_units: [{ payments: { captures: [{ id: `CAP${m[1]}`, status }] } }],
      });
    }
    return json(404, { name: 'NOT_FOUND' });
  };

  approve(orderId: string) {
    const o = this.orders.get(orderId);
    if (o) o.status = 'APPROVED';
  }

  callsTo(method: string, pathPart: string) {
    return this.calls.filter((c) => c.method === method && c.path.includes(pathPart));
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
