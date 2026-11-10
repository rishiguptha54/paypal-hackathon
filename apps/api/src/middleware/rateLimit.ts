import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';

type Bucket = { startedAt: number; count: number };

export function rateLimit(limit: number, windowMs = 60_000) {
  const buckets = new Map<string, Bucket>();
  let requests = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.sessionId ?? req.ip ?? 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    requests += 1;

    if (requests % 256 === 0) {
      for (const [candidate, value] of buckets) {
        if (now - value.startedAt >= windowMs) buckets.delete(candidate);
      }
    }
    if (bucket.count > limit) {
      res.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)),
      );
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
    }
    next();
  };
}
