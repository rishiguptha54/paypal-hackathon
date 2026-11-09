import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { Db } from '../repo/db';
import { appendAudit } from '../repo/audit';

export function auditRejections(db: Db) {
  return async (error: unknown, req: Request, _res: Response, next: NextFunction) => {
    if (error instanceof ZodError && req.sessionId) {
      const fields = error.issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys' ? issue.keys : [],
      );
      if (fields.length) {
        try {
          await db.transaction(async (tx) => {
            await appendAudit(tx, {
              sessionId: req.sessionId,
              type: 'REQUEST_REJECTED',
              payload: {
                route: `${req.method} ${req.baseUrl}${req.path}`,
                unexpectedFields: fields,
              },
            });
          });
        } catch (auditError) {
          req.log.error({ err: auditError }, 'failed to audit rejected request');
          return next(auditError);
        }
      }
    }
    next(error);
  };
}
