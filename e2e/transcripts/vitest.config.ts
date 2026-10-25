import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['*.e2e.test.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
  },
});
