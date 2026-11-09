import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    coverage: {
      include: ['src/core/**/*.ts'],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
