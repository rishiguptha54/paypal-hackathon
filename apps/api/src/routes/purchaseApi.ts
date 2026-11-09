import { Router } from 'express';
import { z } from 'zod';
import {
  ApprovePurchaseRequestSchema,
  CancelPurchaseRequestSchema,
  CreatePurchaseRequestSchema,
} from '@intentlock/shared';
import type { PurchaseApiService } from '../services/purchaseApi';
import { rateLimit } from '../middleware/rateLimit';
import type { PaymentService } from '../services/payments';

const IdParams = z.strictObject({ id: z.uuid() });

export function purchaseApiRouter(purchases: PurchaseApiService, payments: PaymentService) {
  const router = Router();

  router.post('/purchases', rateLimit(20), async (req, res) => {
    const body = CreatePurchaseRequestSchema.parse(req.body);
    res
      .status(201)
      .json(await purchases.create(req.sessionId, body.mandateId, body.offerSnapshotId));
  });

  router.get('/purchases/:id', rateLimit(120), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.json(await payments.get(req.sessionId, id, req.log));
  });

  router.post('/purchases/:id/approve', rateLimit(20), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    const body = ApprovePurchaseRequestSchema.parse(req.body);
    res.json(await purchases.approve(req.sessionId, id, body.mandateHash));
  });

  router.post('/purchases/:id/cancel', rateLimit(20), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    CancelPurchaseRequestSchema.parse(req.body);
    res.json(await purchases.cancel(req.sessionId, id));
  });

  return router;
}
