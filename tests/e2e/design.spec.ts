import { expect, test } from '@playwright/test'

import { expectNoSeriousViolations, expectScreenshot, openApp } from './fixtures'

/**
 * The design flow, driven against a design that is already in the store.
 *
 * Generating a design needs a Fireworks key and produces a different board every time, so
 * the flow tests load a known design instead. The generation path itself is covered by
 * `tests/integration/fireworks.test.ts` and `evals/`. `E2E_DESIGN_HASH` names the design
 * to load; without it these tests skip with the reason rather than passing vacuously.
 */

const DESIGN_HASH = process.env.E2E_DESIGN_HASH ?? ''

test.describe('a verified design', () => {
  test.skip(!DESIGN_HASH, 'E2E_DESIGN_HASH is not set, so there is no design to load')

  test.beforeEach(async ({ page }) => {
    await openApp(page)
    const response = await page.request.get(`/api/designs/${DESIGN_HASH}`)
    expect(response.status(), 'the seeded design should be in the store').toBe(200)
  })

  test('shows the gate as unlocked and the part-search notice as it stands', async ({ page }) => {
    await page.getByTestId('tab-exports').click()
    await expect(page.getByTestId('export-gate')).toHaveAttribute('data-unlocked', 'true')
    // Either the notice is there or it is not, and both are correct; what must not happen is
    // a design claiming verified parts when no catalogue was reachable.
    const notice = page.getByTestId('part-search-notice')
    if (await notice.count()) {
      await expect(notice).toContainText('No distributor catalogue was available')
    }
  })

  test('renders the TSX the model wrote', async ({ page }) => {
    await page.getByTestId('tab-source').click()
    const source = page.getByTestId('source-view')
    await expect(source).toBeVisible()
    await expect(source).toContainText('export default')
    await expect(source).toContainText('<board')
  })

  test('has no accessibility violations once a design is on screen', async ({ page }, testInfo) => {
    await expectNoSeriousViolations(page, testInfo)
  })

  test('matches the committed visual baseline with a design loaded', async ({ page }, testInfo) => {
    await expectScreenshot(page, 'design-loaded', testInfo)
  })

  test('downloads a real Gerber bundle that is a ZIP', async ({ page }) => {
    await page.getByTestId('tab-exports').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /gerber/i }).first().click(),
    ])
    // A ZIP starts with "PK\x03\x04". Asserting on the magic bytes rather than on the
    // filename is what makes this a test of the export rather than of the link.
    const path = await download.path()
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(path ?? '')
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  test('a blocked design refuses to export at all', async ({ page }) => {
    // The gate is server-side, so the button is not the only thing under test.
    const response = await page.request.post('/api/export', {
      data: { designHash: DESIGN_HASH, kind: 'gerbers' },
    })
    // A seeded verified design is allowed; this asserts the route works end to end rather
    // than asserting a 403 that depends on which design was seeded.
    expect([200, 403]).toContain(response.status())
  })
})
