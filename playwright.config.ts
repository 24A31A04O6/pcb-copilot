import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end, accessibility and visual-regression configuration.
 *
 * The suite drives the real app against the real API. Two things follow from that:
 *
 *   - A design takes tens of seconds to produce, so a timeout that feels generous in
 *     milliseconds is not generous here. `DESIGN_TIMEOUT` is 180 s because a real
 *     brief -> JSON -> code -> compile -> checks run with an 8,000-token budget is
 *     genuinely that slow on a cold container.
 *   - A live model call costs money and is not deterministic, so the flow tests run
 *     against a seeded design rather than a fresh generation. The generation path is
 *     covered by `tests/integration/fireworks.test.ts` and `evals/`, which is where a
 *     non-deterministic assertion belongs.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  // One worker: the compile sandbox is memory-capped, and parallel browsers turn a slow
  // suite into a flaky one.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['junit', { outputFile: 'reports/e2e.xml' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm run build && pnpm run start -- --port ${PORT}`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
