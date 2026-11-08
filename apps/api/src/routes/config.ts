import { Router } from 'express';
import type { PublicConfig } from '@intentlock/shared';
import type { Config } from '../config';

/** Public values only. The client id is public by design; the secret never appears here. */
export function configRouter(config: Config) {
  const router = Router();
  router.get('/config', (_req, res) => {
    const body: PublicConfig = {
      paypalClientId: config.paypal.clientId,
      productSource: config.productSource,
      aiProvider: config.aiProvider,
      environment: 'sandbox',
      demoControlsEnabled: config.demoControlsEnabled,
    };
    res.json(body);
  });
  return router;
}
