import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const assets = path.resolve('apps/web/dist');
const files = (await readdir(assets, { recursive: true })).filter((file) =>
  /\.(js|css|html|map)$/i.test(file),
);
if (!files.length) throw new Error('No built web assets found. Run npm run build first.');

const patterns = [
  /\b(?:[A-Z0-9_]*CLIENT_SECRET|SESSION_SECRET|DATABASE_URL|[A-Z0-9_]*API_KEY)\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bAQ\.[0-9A-Za-z_-]{20,}\b/,
  /\bsk-[0-9A-Za-z]{20,}\b/,
  /\bpostgres(?:ql)?:\/\/[^:/\s]+:[^@\s]{8,}@/i,
];
for (const file of files) {
  const contents = await readFile(path.join(assets, file), 'utf8');
  if (patterns.some((pattern) => pattern.test(contents)))
    throw new Error(`Potential server credential found in browser asset: ${file}`);
}
process.stdout.write(`SEC-04 passed: scanned ${files.length} built browser assets.\n`);
