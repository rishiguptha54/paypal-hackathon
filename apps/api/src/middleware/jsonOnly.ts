import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';

const JSON_TYPE = /^application\/json\s*(;|$)/i;

/** Non-GET requests must be application/json (415 otherwise); this also blocks form-post CSRF. */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) {
    return next(
      new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'),
    );
  }
  next();
}
