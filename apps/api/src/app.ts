import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { PayPalRestClient } from './adapters/paypal/client';
import type { PayPalOrderGateway } from './adapters/paypalMcp/gateway';
import type { Config } from './config';
import type { Logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requireJsonBody } from './middleware/jsonOnly';
import { requestContext } from './middleware/requestContext';
import { securityHeaders } from './middleware/security';
import { sessionMiddleware } from './middleware/session';
import type { Db } from './repo/db';
import { configRouter } from './routes/config';
import { healthRouter } from './routes/health';
import { purchasesRouter } from './routes/purchases';
import { PaymentService } from './services/payments';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  rest: PayPalRestClient;
  gateway: PayPalOrderGateway;
  /** Built SPA directory; served only when it exists. */
  webDistDir?: string;
}

export function createApp(deps: AppDeps): Express {
  const { config, db, logger, rest, gateway } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.nodeEnv === 'production') app.set('trust proxy', 1);

  app.use(requestContext(logger));
  app.use(securityHeaders(config.nodeEnv === 'production'));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(healthRouter({ db, rest, gateway }));
  api.use(requireJsonBody);
  api.use(express.json({ limit: '16kb', strict: true, type: 'application/json' }));
  api.use(cookieParser(config.sessionSecret));
  api.use(sessionMiddleware(db));

  const payments = new PaymentService({
    db,
    gateway,
    rest,
    approvalTtlSeconds: config.approvalTtlSeconds,
  });
  api.use(configRouter(config));
  api.use(purchasesRouter(payments));
  api.use(notFoundHandler);
  app.use('/api', api);

  const webDist = deps.webDistDir;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
