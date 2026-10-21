import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['packages/*/src/**/*.ts'] },
  },
});
