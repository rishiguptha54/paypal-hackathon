import { Router } from 'express';
import { z } from 'zod';
import {
  CreateMandateRequestSchema,
  MandateFieldsSchema,
  SearchOffersRequestSchema,
} from '@intentlock/shared';
import type { MandateService } from '../services/mandates';
import type { OfferService } from '../services/offers';
import { rateLimit } from '../middleware/rateLimit';

const IdParams = z.strictObject({ id: z.uuid() });

export function mandatesRouter(mandates: MandateService, offers: OfferService) {
  const router = Router();

  router.post('/mandates', rateLimit(10), async (req, res) => {
    const body = CreateMandateRequestSchema.parse(req.body);
    res.status(201).json(await mandates.create(req.sessionId, body.requestText));
  });

  router.get('/mandates/:id', rateLimit(120), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.json(await mandates.get(req.sessionId, id));
  });

  router.post('/mandates/:id/confirm', rateLimit(20), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    const fields = MandateFieldsSchema.parse(req.body);
    res.json(await mandates.confirm(req.sessionId, id, fields));
  });

  router.post('/mandates/:id/search', rateLimit(20), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    SearchOffersRequestSchema.parse(req.body);
    res.json(await offers.search(req.sessionId, id));
  });

  return router;
}
