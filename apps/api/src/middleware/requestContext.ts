import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../logger';

/** Assigns requestId, exposes X-Request-Id, and logs one line per request. */
export function requestContext(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.id = randomUUID();
    req.log = logger.child({ requestId: req.id });
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      req.log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        },
        'request',
      );
    });
    next();
  };
}
