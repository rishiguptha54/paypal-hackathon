import { PayPalRestClient } from '../../src/adapters/paypal/client';
import type { PayPalOrderGateway } from '../../src/adapters/paypalMcp/gateway';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createLogger } from '../../src/logger';
import { createTestDb } from './db';
import { FakePayPal } from './fakePaypal';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_SECRET: 's'.repeat(40),
  PAYPAL_CLIENT_ID: 'test-client-id',
  PAYPAL_CLIENT_SECRET: 'test-client-secret',
  PAYPAL_ENV: 'sandbox',
} as const;

export async function buildTestApp(
  opts: {
    gateway?: (rest: PayPalRestClient) => PayPalOrderGateway;
    env?: Record<string, string>;
  } = {},
) {
  const { db, close } = await createTestDb();
  const fake = new FakePayPal();
  const config = loadConfig({ ...TEST_ENV, ...opts.env } as NodeJS.ProcessEnv);
  const rest = new PayPalRestClient({
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
    fetch: fake.fetch,
  });
  const gateway = (opts.gateway ?? restOnlyGateway)(rest);
  const app = createApp({ config, db, logger: createLogger({ level: 'silent' }), rest, gateway });
  return { app, db, fake, rest, gateway, config, close };
}

/** Gateway double that serves create/read from the REST fake and reports MCP as down. */
export function restOnlyGateway(
  rest: PayPalRestClient,
): PayPalOrderGateway & { createCalls: number } {
  const g = {
    createCalls: 0,
    async createOrder(input: Parameters<PayPalOrderGateway['createOrder']>[0]) {
      g.createCalls++;
      const r = await rest.createOrder(input, input.requestId);
      return {
        data: r.data,
        httpStatus: r.httpStatus,
        debugId: r.debugId,
        trace: trace('create_order', r.data.id),
      };
    },
    async getOrder(orderId: string) {
      const r = await rest.getOrder(orderId);
      return {
        data: r.data,
        httpStatus: r.httpStatus,
        debugId: r.debugId,
        trace: trace('get_order', orderId),
      };
    },
    mcpStatus: () => 'down' as const,
    close: async () => undefined,
  };
  return g;
}

function trace(tool: 'create_order' | 'get_order', orderId: string) {
  return {
    tool,
    channel: 'rest' as const,
    status: 'ok' as const,
    durationMs: 1,
    at: new Date().toISOString(),
    orderId,
    fallbackToRest: true,
  };
}
