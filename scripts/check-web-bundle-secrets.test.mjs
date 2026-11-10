import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const scanner = fileURLToPath(new URL('./check-web-bundle-secrets.mjs', import.meta.url));

test('SEC-04 scans HTML, nested chunks and source maps, without exposing matched values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentlock-bundle-'));
  try {
    const dist = path.join(dir, 'apps', 'web', 'dist');
    mkdirSync(path.join(dist, 'assets', 'nested'), { recursive: true });
    const run = () => spawnSync(process.execPath, [scanner], { cwd: dir, encoding: 'utf8' });
    writeFileSync(path.join(dist, 'index.html'), '<h1>Sandbox</h1>');
    assert.equal(run().status, 0);
    for (const [file, value] of [
      ['index.html', 'PAYPAL_CLIENT_SECRET'],
      ['assets/chunk.js', `sk-${'x'.repeat(24)}`],
      ['assets/nested/chunk.js.map', `AIza${'x'.repeat(24)}`],
      ['assets/style.css', 'CHANNEL3_API_KEY'],
    ]) {
      const target = path.join(dist, file);
      writeFileSync(target, value);
      const result = run();
      assert.equal(result.status, 1, file);
      assert.match(result.stderr, /Potential server credential/);
      assert.ok(!result.stderr.includes(value));
      writeFileSync(target, '');
    }
    writeFileSync(
      path.join(dist, 'assets', 'license.js'),
      'const license = "public-license-sentinel";',
    );
    assert.equal(run().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
