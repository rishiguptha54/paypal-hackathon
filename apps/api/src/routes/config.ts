import { Router } from 'express';
import type { PublicConfig } from '@intentlock/shared';
import type { CatalogService } from '../adapters/catalog/catalogService';
import type { Config } from '../config';
import { rateLimit } from '../middleware/rateLimit';

/** Public values only. The client id is public by design; the secret never appears here. */
export function configRouter(config: Config, catalog: CatalogService) {
  const router = Router();
  router.get('/config', rateLimit(120), (_req, res) => {
    const body: PublicConfig = {
      paypalClientId: config.paypal.clientId,
      productSource: config.productSource,
      aiProvider: config.aiProvider,
      environment: 'sandbox',
      merchantPresets: catalog.merchantPresets(),
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
      demoControlsEnabled: config.demoControlsEnabled,
      studioAgentEnabled: config.studioAgentEnabled,
    };
    res.json(body);
  });
  return router;
}
