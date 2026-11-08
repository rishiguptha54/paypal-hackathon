import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '../../src/repo/db';
import * as schema from '../../src/repo/schema';
import { MIGRATIONS_DIR } from '../../src/paths';

/** In-process Postgres with the real migrations applied. No Docker, no network. */
export async function createTestDb() {
  const client = new PGlite();
  const orm = drizzle(client, { schema });
  await migrate(orm, { migrationsFolder: MIGRATIONS_DIR });
  return { db: orm as unknown as Db, close: () => client.close() };
}
