import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { CheckStatus, HealthResponse } from '@intentlock/shared';
import type { PayPalOrderGateway } from '../adapters/paypalMcp/gateway';
import type { PayPalRestClient } from '../adapters/paypal/client';
import type { Db } from '../repo/db';
import type { CatalogService } from '../adapters/catalog/catalogService';
import { rateLimit } from '../middleware/rateLimit';

/** Status values only (FR-18): never URLs, keys or error text. */
export function healthRouter(deps: {
  db: Db;
  rest: PayPalRestClient;
  gateway: PayPalOrderGateway;
  catalog: CatalogService;
  aiStatus: () => CheckStatus;
}) {
  const router = Router();
  router.get('/health', rateLimit(120), async (_req, res) => {
    const [db, paypal] = await Promise.all([
      deps.db.execute(sql`select 1`).then(
        (): CheckStatus => 'ok',
        (): CheckStatus => 'down',
      ),
      deps.rest.isReachable().then((ok): CheckStatus => (ok ? 'ok' : 'down')),
    ]);
    const paypalMcp = deps.gateway.mcpStatus();
    const catalog = deps.catalog.status();
    const ai = deps.aiStatus();
    const checks = { db, paypal, paypalMcp, catalog, ai };
    const status: CheckStatus =
      db === 'down' ? 'down' : Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded';
    const body: HealthResponse = { status, checks };
    res.status(status === 'down' ? 503 : 200).json(body);
  });
  return router;
}
