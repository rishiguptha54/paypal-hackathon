import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { CheckStatus, HealthResponse } from '@intentlock/shared';
import type { PayPalOrderGateway } from '../adapters/paypalMcp/gateway';
import type { PayPalRestClient } from '../adapters/paypal/client';
import type { Db } from '../repo/db';

/** Status values only (FR-18): never URLs, keys or error text. */
export function healthRouter(deps: {
  db: Db;
  rest: PayPalRestClient;
  gateway: PayPalOrderGateway;
}) {
  const router = Router();
  router.get('/health', async (_req, res) => {
    const [db, paypal] = await Promise.all([
      deps.db.execute(sql`select 1`).then(
        (): CheckStatus => 'ok',
        (): CheckStatus => 'down',
      ),
      deps.rest.isReachable().then((ok): CheckStatus => (ok ? 'ok' : 'down')),
    ]);
    const paypalMcp = deps.gateway.mcpStatus();
    const status: CheckStatus =
      db === 'down'
        ? 'down'
        : db === 'ok' && paypal === 'ok' && paypalMcp === 'ok'
          ? 'ok'
          : 'degraded';
    const body: HealthResponse = { status, checks: { db, paypal, paypalMcp } };
    res.status(status === 'down' ? 503 : 200).json(body);
  });
  return router;
}
