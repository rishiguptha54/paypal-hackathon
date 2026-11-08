import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { sessions } from './schema';

export const SESSION_IDLE_DAYS = 7;

/** Returns true when the session exists and is not idle-expired; refreshes last_seen_at. */
export async function touchSession(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(sessions.id, id),
        sql`${sessions.lastSeenAt} > now() - make_interval(days => ${SESSION_IDLE_DAYS})`,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length === 1;
}

export async function createSession(db: Db): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({ id });
  return id;
}
