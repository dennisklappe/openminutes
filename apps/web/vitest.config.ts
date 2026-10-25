import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['../../packages/db/src/testing/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
