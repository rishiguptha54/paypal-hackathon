import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { Db } from '../repo/db';
import { createSession, SESSION_IDLE_DAYS, touchSession } from '../repo/sessions';

export const SESSION_COOKIE = 'il_sid';

const idSchema = z.uuid();

/**
 * Anonymous signed session. The cookie value is only a lookup key: it is HMAC-signed by
 * cookie-parser, and an unknown, tampered or idle-expired value silently starts a new session.
 */
export function sessionMiddleware(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw: unknown = req.signedCookies?.[SESSION_COOKIE];
    const parsed = idSchema.safeParse(raw);
    if (parsed.success && (await touchSession(db, parsed.data))) {
      req.sessionId = parsed.data;
      return next();
    }
    const id = await createSession(db);
    res.cookie(SESSION_COOKIE, id, {
      signed: true,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000,
    });
    req.sessionId = id;
    next();
  };
}
