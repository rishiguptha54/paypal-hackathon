import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npx tsx ../apps/api/test/fixtures/browserServer.ts',
    url: 'http://127.0.0.1:3100/api/config',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
