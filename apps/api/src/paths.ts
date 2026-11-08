import { fileURLToPath } from 'node:url';

// Both src/ (tsx, vitest) and dist/ (tsup bundle) sit one level below apps/api,
// so these resolve identically in dev, test and production.
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
export const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
