import { expect, test } from '@playwright/test'

import { expectNoSeriousViolations, expectScreenshot, openApp } from './fixtures'

/**
 * What a first-time visitor can actually do.
 *
 * These are deliberately not "does the model produce a board" tests. That path is
 * non-deterministic, costs money, and is covered by `evals/`; a browser test that asserts
 * on model output fails for reasons the browser has nothing to do with.
 */

test.describe('the app shell', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('renders the brief form and the mascot', async ({ page }) => {
    await expect(page.getByTestId('brief-input')).toBeVisible()
    await expect(page.getByTestId('generate')).toBeVisible()
    await expect(page.locator('svg').first()).toBeVisible()
  })

  test('has no accessibility violations with a real impact', async ({ page }, testInfo) => {
    await expectNoSeriousViolations(page, testInfo)
  })

  test('matches the committed visual baseline', async ({ page }, testInfo) => {
    await expectScreenshot(page, 'empty-state', testInfo)
  })

  test('exposes every design view as a real tab', async ({ page }) => {
    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    expect(count).toBeGreaterThan(2)
    for (let i = 0; i < count; i += 1) {
      await expect(tabs.nth(i)).toHaveAttribute('aria-selected', /true|false/)
    }
  })

  test('switches tabs and keeps the panel labelled', async ({ page }) => {
    const first = page.getByRole('tab').first()
    const second = page.getByRole('tab').nth(1)
    await second.click()
    await expect(second).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toBeVisible()
    await first.click()
    await expect(first).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('brief validation', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('counts characters as you type', async ({ page }) => {
    const input = page.getByTestId('brief-input')
    await input.fill('A 40 by 25 mm board with a resistor and an LED.')
    await expect(page.getByTestId('brief-counter')).toContainText('A 40 by 25 mm board')
  })

  test('refuses to generate from an empty brief', async ({ page }) => {
    const generate = page.getByTestId('generate')
    await expect(generate).toBeDisabled()
  })

  test('refuses a brief that is only whitespace', async ({ page }) => {
    await page.getByTestId('brief-input').fill('     \n   ')
    await expect(page.getByTestId('generate')).toBeDisabled()
  })

  test('enables generation for a real brief', async ({ page }) => {
    await page
      .getByTestId('brief-input')
      .fill('A 40 by 25 mm board with a 1k resistor and an LED in series on a two-pin header.')
    await expect(page.getByTestId('generate')).toBeEnabled()
  })
})

test.describe('board colour', () => {
  test('lets a colour be chosen and says what it does', async ({ page }) => {
    await openApp(page)
    const swatches = page.locator('[data-testid^="swatch-"]')
    const count = await swatches.count()
    expect(count).toBeGreaterThan(1)
    await swatches.nth(1).click()
    await expect(swatches.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('silkscreen-note')).toBeVisible()
  })
})

test.describe('exports before a design exists', () => {
  test('are locked and say why', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('tab-exports').click()
    await expect(page.getByTestId('export-gate')).toHaveAttribute('data-unlocked', 'false')
    await expect(page.getByTestId('export-gate')).toContainText('blocking check')
  })
})

test.describe('history drawer', () => {
  test('opens, traps nothing, and closes on Escape', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('open-history').click()
    const dialog = page.getByRole('dialog', { name: 'Design history' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
