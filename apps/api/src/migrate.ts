import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLogger } from './logger';
import { MIGRATIONS_DIR } from './paths';
import { createPgDb } from './repo/db';

// Run as the Render pre-deploy command, never at request time. Reads DATABASE_URL only so it
// does not require PayPal credentials.
async function run() {
  const logger = createLogger();
  const url = process.env['DATABASE_URL'];
  if (!url || url.includes('REPLACE_ME')) {
    logger.fatal('DATABASE_URL is not set');
    process.exit(1);
  }
  const { db, close } = createPgDb(url);
  try {
    await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_DIR });
    logger.info('migrations applied');
  } finally {
    await close();
  }
}

run().catch((e: unknown) => {
  createLogger().fatal({ err: e instanceof Error ? e.message : 'unknown' }, 'migration failed');
  process.exit(1);
});
