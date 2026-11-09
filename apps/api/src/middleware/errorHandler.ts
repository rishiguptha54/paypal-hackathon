import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, UpstreamError, toAppError } from '../errors';

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof UpstreamError) return toAppError(err);
  if (err instanceof ZodError) {
    const unexpected = err.issues.some((i) => i.code === 'unrecognized_keys');
    return new AppError(
      400,
      unexpected ? 'UNEXPECTED_FIELD' : 'VALIDATION_FAILED',
      unexpected ? 'Request contains unexpected fields.' : 'Request validation failed.',
      // Paths and messages only; never echo submitted values.
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size.');
  }
  if (type === 'entity.parse.failed') {
    return new AppError(400, 'VALIDATION_FAILED', 'Request body is not valid JSON.');
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding.');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', 'Resource not found.'));
}

/** Error envelope from API contract section 1. Stack traces are logged, never returned. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  const app = normalize(err);
  if (app.status >= 500) req.log.error({ err }, 'request failed');
  else req.log.info({ code: app.code, status: app.status }, 'request rejected');
  res.status(app.status).json({
    error: {
      code: app.code,
      message: app.message,
      requestId: req.id,
      ...(app.details.length > 0 && { details: app.details }),
    },
  });
}
