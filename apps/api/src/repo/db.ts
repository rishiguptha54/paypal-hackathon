import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/** Driver-agnostic handle: node-postgres in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalDatabase(databaseUrl: string): boolean {
  return LOCAL_HOSTS.has(new URL(databaseUrl).hostname);
}

export function createPgDb(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 10_000,
    // TLS with certificate verification is mandatory for any non-local database.
    ssl: isLocalDatabase(databaseUrl) ? false : true,
  });
  return { db: drizzle(pool, { schema }) as Db, pool, close: () => pool.end() };
}

export { schema };
