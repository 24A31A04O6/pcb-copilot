import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'

/**
 * Shared helpers for the browser suite.
 */

/**
 * A design that is already compiled, checked and stored.
 *
 * The API accepts a design hash, and the app ships with the golden corpus compiled into
 * the repository, so the flow tests can drive the whole UI without asking a model for
 * anything. `E2E_SEED_DESIGN_HASH` points at whatever the deployment wants to use; without
 * it the tests that need a design skip rather than hang waiting for one that will not come.
 */
export const SEED_HASH = process.env.E2E_SEED_DESIGN_HASH ?? ''

export async function openApp(page: Page): Promise<void> {
  const response = await page.goto('/')
  expect(response?.status(), 'the app root should render').toBeLessThan(400)
  await expect(page.getByRole('heading').first()).toBeVisible()
}

/**
 * Run axe over the page and fail on anything with a real impact.
 *
 * `minor` is excluded on purpose: axe reports colour-contrast and region advisories that
 * this design system deliberately makes (the neobrutalist palette is high contrast by
 * construction, and the reduced-motion rules are tested directly). A gate that cries wolf
 * on a11y advisories is a gate people disable.
 */
export async function expectNoSeriousViolations(page: Page, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  await testInfo.attach('axe', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  })
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(
    blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`),
    'accessibility violations with a real impact',
  ).toEqual([])
}

/**
 * Visual regression.
 *
 * The baseline is committed under `tests/e2e/__screenshots__`. A diff here is either a
 * deliberate design change -- in which case review the image and commit the new baseline
 * with `--update-snapshots` -- or a regression in the design system.
 */
export async function expectScreenshot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  // The 3D canvas renders a frame or two after mount; screenshotting earlier compares a
  // blank canvas and produces a baseline that hides a real regression.
  await page.waitForTimeout(750)
  await expect(page).toHaveScreenshot(`${name}.png`, {
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
  })
  void testInfo
}
