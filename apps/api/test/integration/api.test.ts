import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { buildTestApp, restOnlyGateway } from '../helpers/app';
import { RuleBasedParser } from '../../src/adapters/intentParser/ruleBasedParser';
import { approvedPurchase } from '../helpers/flow';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

/** Secure cookies are not replayed over http by cookie jars, so carry the cookie by hand. */
function client(app: Express) {
  let cookie = '';
  const withCookie = (t: request.Test) => (cookie ? t.set('Cookie', cookie) : t);
  const capture = (res: request.Response) => {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    if (set?.[0]) cookie = set[0].split(';')[0] as string;
    return res;
  };
  return {
    get: async (p: string) => capture(await withCookie(request(app).get(p))),
    post: async (p: string, body: unknown = {}) =>
      capture(
        await withCookie(
          request(app)
            .post(p)
            .send(body as object),
        ),
      ),
    cookie: () => cookie,
    setCookie: (c: string) => {
      cookie = c;
    },
  };
}

describe('SEC-11 security headers', () => {
  it('matches spec/security.md section 5', async () => {
    const res = await request(ctx.app).get('/api/config');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(
      "script-src 'self' https://www.sandbox.paypal.com https://www.paypal.com https://*.paypal.com",
    );
    expect(csp).toContain(
      'frame-src https://www.sandbox.paypal.com https://www.paypal.com https://*.paypal.com',
    );
    expect(csp).toContain("connect-src 'self' https://www.sandbox.paypal.com https://*.paypal.com");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com")',
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS only in production', async () => {
    const prod = await buildTestApp({ env: { NODE_ENV: 'production' } });
    const res = await request(prod.app).get('/api/health');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    await prod.close();
  });
});

describe('SEC-12 JSON only + 16 KB limit', () => {
  it('returns 415 for non-JSON POST bodies', async () => {
    const res = await request(ctx.app)
      .post('/api/dev/purchases')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 415 for form posts and for a POST with no content type', async () => {
    const form = await request(ctx.app).post('/api/dev/purchases').type('form').send('a=b');
    expect(form.status).toBe(415);
    expect((await request(ctx.app).post('/api/dev/purchases')).status).toBe(415);
  });

  it('returns 413 above 16 KB', async () => {
    const res = await request(ctx.app)
      .post('/api/dev/purchases')
      .send({ pad: 'x'.repeat(17 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 for malformed JSON and unexpected fields', async () => {
    const bad = await request(ctx.app)
      .post('/api/dev/purchases')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(bad.status).toBe(400);
    const extra = await request(ctx.app).post('/api/purchases').send({ total: '0.01' });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('UNEXPECTED_FIELD');
  });
});

describe('SEC-02 error envelope', () => {
  it('hides stack traces, paths and secrets on an unexpected exception', async () => {
    const boom = await buildTestApp({
      gateway: (rest) => ({
        ...restOnlyGateway(rest),
        createOrder: async () => {
          throw new Error('kaboom at C:\\secret\\path\\file.ts with token abc123');
        },
      }),
    });
    const c = client(boom.app);
    const p = await approvedPurchase(c);
    const res = await c.post(`/api/purchases/${p.id}/paypal/create-order`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong.',
        requestId: expect.any(String),
      },
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/kaboom|secret|abc123|\.ts|at Object|stack/i);
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    await boom.close();
  });

  it('uses the envelope for 404 and invalid ids', async () => {
    const c = client(ctx.app);
    const nf = await c.get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    const bad = await c.post('/api/purchases/not-a-uuid/paypal/create-order');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('sessions (il_sid)', () => {
  it('sets a signed HttpOnly Secure SameSite=Lax cookie on first request', async () => {
    const res = await request(ctx.app).get('/api/config');
    const raw = (res.headers['set-cookie'] as unknown as string[])[0] as string;
    expect(raw).toMatch(/^il_sid=s%3A[0-9a-f-]{36}\./);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Max-Age=604800/);
  });

  it('reuses a valid session and replaces a tampered cookie', async () => {
    const c = client(ctx.app);
    await c.get('/api/config');
    const good = c.cookie();
    const again = await request(ctx.app).get('/api/config').set('Cookie', good);
    expect(again.headers['set-cookie']).toBeUndefined();

    const tampered = good.slice(0, -2) + (good.endsWith('aa') ? 'bb' : 'aa');
    const res = await request(ctx.app).get('/api/config').set('Cookie', tampered);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^il_sid=s%3A/);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).not.toBe(tampered);
  });
});

describe('GET /api/config and /api/health', () => {
  it('exposes public values only', async () => {
    const res = await request(ctx.app).get('/api/config');
    expect(res.body).toEqual({
      paypalClientId: 'test-client-id',
      productSource: 'fixture',
      aiProvider: 'rule',
      environment: 'sandbox',
      merchantPresets: [
        'northstar-office.example',
        'northstar-office.example.unlisted-supply.example',
        'unlisted-supply.example',
      ],
      scenarioPresets: [
        {
          id: 'HAPPY_PATH',
          label: 'Allowed purchase',
          requestText:
            'Buy 1 ergonomic desk chair for no more than $120 from northstar-office.example.',
        },
        {
          id: 'BLOCKED_OFFER',
          label: 'Over-budget offer',
          requestText:
            'Buy 1 ergonomic desk chair for no more than $50 from northstar-office.example.',
        },
        {
          id: 'PRECAPTURE_DRIFT',
          label: 'Pre-capture drift',
          requestText:
            'Buy 1 ergonomic desk chair for no more than $120 from northstar-office.example.',
        },
      ],
      demoControlsEnabled: false,
      studioAgentEnabled: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/test-client-secret|DATABASE|SESSION/);
  });

  it('INT-25: health reports MCP down with status values only', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { db: 'ok', paypal: 'ok', paypalMcp: 'down', catalog: 'ok', ai: 'ok' },
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/https?:|key|secret|error|token/i);
  });

  it('reports down (503) when the database is unreachable', async () => {
    const broken = await buildTestApp();
    await broken.close();
    const res = await request(broken.app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.checks.db).toBe('down');
  });

  it('reflects Gemini fallback status changes without restarting the API', async () => {
    let aiStatus: 'ok' | 'degraded' = 'ok';
    const parser = new RuleBasedParser();
    const probe = await buildTestApp({
      parser: {
        parse: (text) => parser.parse(text),
        status: () => aiStatus,
      },
    });
    expect((await request(probe.app).get('/api/health')).body.checks.ai).toBe('ok');
    aiStatus = 'degraded';
    expect((await request(probe.app).get('/api/health')).body.checks.ai).toBe('degraded');
    await probe.close();
  });
});
