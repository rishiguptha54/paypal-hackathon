import { Router } from 'express';
import { z } from 'zod';
import { DemoSeedRequestSchema, SimulateDriftRequestSchema } from '@intentlock/shared';
import { notFound } from '../errors';
import { rateLimit } from '../middleware/rateLimit';
import type { DemoRepository } from '../repo/demo';

export function demoRouter(demo: DemoRepository, enabled: boolean) {
  const router = Router();
  const guard = () => {
    if (!enabled) throw notFound();
  };
  router.post('/purchases/:id/simulate-drift', async (req, res) => {
    guard();
    const { id } = z.strictObject({ id: z.uuid() }).parse(req.params);
    const { kind } = SimulateDriftRequestSchema.parse(req.body);
    res.json(await demo.drift(req.sessionId, id, kind));
  });
  router.post('/demo/seed', rateLimit(3), async (req, res) => {
    guard();
    DemoSeedRequestSchema.parse(req.body);
    const result = await demo.seed(req.sessionId);
    res.status(result.created ? 201 : 200).json({ seeded: result.seeded });
  });
  return router;
}
