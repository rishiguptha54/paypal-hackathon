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
import { MandateService } from './services/mandates';
import { OfferService } from './services/offers';
import { PurchaseApiService } from './services/purchaseApi';
import type { IntentParser } from './adapters/intentParser/types';
import type { CatalogService } from './adapters/catalog/catalogService';
import { mandatesRouter } from './routes/mandates';
import { purchaseApiRouter } from './routes/purchaseApi';
import { AuditRepository } from './repo/auditViews';
import { DemoRepository } from './repo/demo';
import { auditRouter } from './routes/audit';
import { demoRouter } from './routes/demo';
import { auditRejections } from './middleware/auditRejections';
import { rateLimit } from './middleware/rateLimit';
import { notFound } from './errors';
import { AnalyticsRepository } from './repo/analytics';
import { studioRouter } from './routes/studio';
import { geminiStudioGenerator, type StudioGenerator } from './adapters/studio/gemini';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  rest: PayPalRestClient;
  gateway: PayPalOrderGateway;
  parser: IntentParser;
  catalog: CatalogService;
  studioGenerator?: StudioGenerator;
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
  api.use(
    healthRouter({
      db,
      rest,
      gateway,
      catalog: deps.catalog,
      aiStatus: () => deps.parser.status(),
    }),
  );
  api.use(['/demo/seed', '/purchases/:id/simulate-drift'], (_req, _res, next) => {
    if (!config.demoControlsEnabled) throw notFound();
    next();
  });
  api.use(requireJsonBody);
  const json = express.json({ limit: '16kb', strict: true, type: 'application/json' });
  const studioJson = express.json({ limit: '256kb', strict: true, type: 'application/json' });
  api.use((req, res, next) => {
    if (req.path === '/studio-agent/turn') {
      if (!config.studioAgentEnabled) return next(notFound());
      return studioJson(req, res, next);
    }
    return json(req, res, next);
  });
  api.use(cookieParser(config.sessionSecret));
  api.use(sessionMiddleware(db));

  const payments = new PaymentService({
    db,
    gateway,
    rest,
    policyVersion: config.policyVersion,
  });
  const mandateService = new MandateService({ db, parser: deps.parser });
  const offerService = new OfferService({
    db,
    catalog: deps.catalog,
    policyVersion: config.policyVersion,
  });
  const purchaseApiService = new PurchaseApiService({
    db,
    policyVersion: config.policyVersion,
    approvalTtlSeconds: config.approvalTtlSeconds,
  });
  api.use(configRouter(config, deps.catalog));
  const paymentLimit = rateLimit(20);
  api.use('/purchases', (req, res, next) =>
    req.method === 'GET' ? next() : paymentLimit(req, res, next),
  );
  api.use(mandatesRouter(mandateService, offerService));
  api.use(purchaseApiRouter(purchaseApiService, payments));
  api.use(purchasesRouter(payments));
  api.use(auditRouter(new AuditRepository(db)));
  api.use(
    studioRouter(
      new AnalyticsRepository(db),
      config.studioAgentEnabled,
      deps.studioGenerator ??
        (config.studioAgentEnabled && config.aiApiKey
          ? geminiStudioGenerator(config.aiApiKey, config.aiModel)
          : undefined),
      logger,
    ),
  );
  api.use(demoRouter(new DemoRepository(db, config.policyVersion), config.demoControlsEnabled));
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
  app.use(auditRejections(db));
  app.use(errorHandler);
  return app;
}
