import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source, so it is inlined into the bundle.
  noExternal: ['@intentlock/shared'],
});
