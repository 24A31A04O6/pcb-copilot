import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      // The golden suite spawns a real compiler per design, so it is opt-in: run it with
      // `pnpm run test:golden` or in CI, not on every `pnpm test`.
      ...(process.env.GOLDEN ? ['tests/golden/**/*.test.ts'] : []),
    ],
    globals: false,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/server/compile/worker-source.ts'],
    },
    testTimeout: 30_000,
    // Compiling a golden board takes seconds, not milliseconds.
    hookTimeout: process.env.GOLDEN ? 600_000 : 30_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
