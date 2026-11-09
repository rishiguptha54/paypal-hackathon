import { Router } from 'express';
import { z } from 'zod';
import { AuditQuerySchema } from '@intentlock/shared';
import { rateLimit } from '../middleware/rateLimit';
import type { AuditRepository } from '../repo/auditViews';

const IdParams = z.strictObject({ id: z.uuid() });

export function auditRouter(audit: AuditRepository) {
  const router = Router();
  router.use(['/audit', '/offers/:id/receipt', '/purchases/:id/receipt'], rateLimit(120));
  router.get('/audit', async (req, res) => {
    res.json(await audit.ledger(req.sessionId, AuditQuerySchema.parse(req.query)));
  });
  router.get('/audit/verify', async (req, res) => {
    z.strictObject({}).parse(req.query);
    res.json(await audit.verify(req.sessionId));
  });
  router.get('/purchases/:id/receipt', async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.json(await audit.receipt(req.sessionId, id, 'PURCHASE'));
  });
  router.get('/offers/:id/receipt', async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.json(await audit.receipt(req.sessionId, id, 'OFFER'));
  });
  return router;
}
