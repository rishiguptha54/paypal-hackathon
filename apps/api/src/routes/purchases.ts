import { Router } from 'express';
import { z } from 'zod';
import { CaptureRequestSchema, CreateOrderRequestSchema } from '@intentlock/shared';
import type { PaymentService } from '../services/payments';

const IdParams = z.object({ id: z.uuid() });

export function purchasesRouter(payments: PaymentService) {
  const router = Router();

  // TEMPORARY (Stage 1) until the mandate + approval flow exists.
  router.post('/dev/purchases', async (req, res) => {
    CreateOrderRequestSchema.parse(req.body);
    res.status(201).json(await payments.createTemporaryPurchase(req.sessionId));
  });

  router.post('/purchases/:id/paypal/create-order', async (req, res) => {
    const { id } = IdParams.parse(req.params);
    CreateOrderRequestSchema.parse(req.body);
    res.json(await payments.createPayPalOrder(req.sessionId, id, req.log));
  });

  router.post('/purchases/:id/paypal/capture', async (req, res) => {
    const { id } = IdParams.parse(req.params);
    const body = CaptureRequestSchema.parse(req.body);
    res.json(await payments.capturePayPalOrder(req.sessionId, id, body.paypalOrderId, req.log));
  });

  return router;
}
