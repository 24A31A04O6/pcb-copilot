import { expect, test } from '@playwright/test'

/**
 * The health endpoint and the security headers.
 *
 * These are API tests that happen to run in the browser suite because they are the two
 * things a deployment breaks most often and notices least.
 */

test.describe('health', () => {
  test('reports status without leaking a secret', async ({ request }) => {
    const response = await request.get('/api/health')
    const body = (await response.json()) as Record<string, unknown>
    expect(body['status']).toMatch(/^(ok|degraded)$/)
    // The status code follows the body: a deployment with no API key is not ready, and
    // saying so with a 503 is what stops a load balancer sending it real traffic.
    expect(response.status()).toBe(body['status'] === 'ok' ? 200 : 503)
    expect(response.headers()['cache-control']).toBe('no-store')

    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/fw_[A-Za-z0-9]|mcp_[A-Za-z0-9]|sk-[A-Za-z0-9]/)
    // A degraded deployment names the variable that is wrong, never its value.
    if (body['status'] === 'degraded') {
      expect(String(body['envError'])).toMatch(/FIREWORKS_API_KEY/)
    }
  })

  test('publishes the toolchain it is running', async ({ request }) => {
    const body = (await (await request.get('/api/health')).json()) as {
      toolchain: Record<string, string>
      fabPresets: Array<{ id: string; checkedOn: string }>
    }
    // A pinned toolchain is the difference between "it compiled last week" and a bug report
    // that can be reproduced, so the versions are part of the contract.
    expect(body.toolchain['@tscircuit/eval']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(body.fabPresets.length).toBeGreaterThan(0)
    for (const preset of body.fabPresets) {
      expect(preset.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  test('answers quickly enough to sit in front of a load balancer', async ({ request }) => {
    const started = Date.now()
    await request.get('/api/health')
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})

test.describe('security headers', () => {
  test('are present on every response', async ({ request }) => {
    const response = await request.get('/')
    const headers = response.headers()
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(headers['strict-transport-security']).toContain('max-age=')
    expect(headers['content-security-policy-report-only'] ?? headers['content-security-policy']).toContain(
      "default-src 'self'",
    )
  })

  test('the streaming design endpoint is not buffered or cached', async ({ request }) => {
    const response = await request.post('/api/design', { data: { brief: 'a board' } })
    const headers = response.headers()
    expect(headers['cache-control']).toContain('no-cache')
    // 400/429/503 are all acceptable here: with no key in CI the route answers 503, and the
    // point of the test is the header, not the status.
    expect([400, 402, 422, 429, 500, 503]).toContain(response.status())
  })
})
