export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export type CaptureMode = 'COMPLETED' | 'PENDING' | 'DECLINE' | 'TIMEOUT' | 'ERROR_500';
export interface FakeOrder {
  total: string;
  status: string;
  customId?: string;
  invoiceId?: string;
  captures?: { id: string; status: string; amount: { currency_code: string; value: string } }[];
}

/** Minimal PayPal Sandbox double behind a fetch-compatible function. */
export class FakePayPal {
  calls: FakeCall[] = [];
  orders = new Map<string, FakeOrder>();
  onOrderChange?: () => void;
  beforeCapture?: () => Promise<void>;
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
      const unit = (body as { purchase_units: { custom_id?: string; invoice_id?: string }[] })
        .purchase_units[0];
      this.orders.set(id, {
        total,
        status: 'CREATED',
        customId: unit?.custom_id,
        invoiceId: unit?.invoice_id,
      });
      this.onOrderChange?.();
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
        payer: {
          email_address: 'sandbox-buyer@example.invalid',
          name: { given_name: 'PayerGivenSentinel', surname: 'PayerSurnameSentinel' },
        },
        purchase_units: [
          {
            reference_id: 'default',
            custom_id: order.customId,
            invoice_id: order.invoiceId,
            amount: { currency_code: 'USD', value: this.liveAmountOverride ?? order.total },
            payments: order.captures ? { captures: order.captures } : undefined,
          },
        ],
      });
    }
    if (m && order && method === 'PATCH') {
      if (order.status !== 'CREATED') return json(422, { name: 'ORDER_ALREADY_APPROVED' });
      for (const patch of body as { op: string; path: string; value: string }[]) {
        if (patch.path.endsWith('/custom_id')) order.customId = patch.value;
        if (patch.path.endsWith('/invoice_id')) order.invoiceId = patch.value;
      }
      this.onOrderChange?.();
      return new Response(null, { status: 204 });
    }
    if (m && order && method === 'POST' && m[2]) {
      await this.beforeCapture?.();
      if (this.captureMode === 'TIMEOUT') throw new DOMException('timed out', 'TimeoutError');
      if (this.captureMode === 'ERROR_500') return json(500, { name: 'INTERNAL_SERVER_ERROR' });
      if (this.captureMode === 'DECLINE') {
        return json(422, {
          name: 'UNPROCESSABLE_ENTITY',
          details: [{ issue: 'INSTRUMENT_DECLINED' }],
        });
      }
      const status = this.captureMode;
      order.status = status === 'COMPLETED' ? 'COMPLETED' : 'APPROVED';
      order.captures = [
        { id: `CAP${m[1]}`, status, amount: { currency_code: 'USD', value: order.total } },
      ];
      this.onOrderChange?.();
      return json(201, {
        id: m[1],
        status,
        payer: {
          email_address: 'sandbox-buyer@example.invalid',
          name: { given_name: 'PayerGivenSentinel', surname: 'PayerSurnameSentinel' },
        },
        purchase_units: [{ payments: { captures: [{ id: `CAP${m[1]}`, status }] } }],
      });
    }
    return json(404, { name: 'NOT_FOUND' });
  };

  approve(orderId: string) {
    const o = this.orders.get(orderId);
    if (o) o.status = 'APPROVED';
    this.onOrderChange?.();
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
