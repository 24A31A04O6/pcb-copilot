/**
 * AUDIT §5.6 — the fabrication gate, end to end through the real route handler.
 *
 * The property under test is the one that matters most in this app: a caller can only get
 * Gerbers for a design the *server* verified. Everything the client controls is either
 * rejected at the schema or ignored in favour of the server's own record.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { POST as exportPost } from '@/app/api/export/route'
import { __resetRateLimits } from '@/lib/server/rate-limit'
import { evaluateDesign } from '@/lib/checks'
import type { DesignResult } from '@/lib/design'
import { runInSandbox } from '@/lib/server/compile/sandbox'
import { saveVerifiedDesign } from '@/lib/server/store'
import { TSCIRCUIT_VERSIONS } from '@/lib/server/versions'

const SOURCE = `
export default () => (
  <board width="40mm" height="25mm">
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="330" footprint="0603" pcbX={-2} pcbY={4} schX={0} schY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={6} pcbY={4} schX={6} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
    <trace from=".C1 > .pin2" to=".J1 > .pin2" />
  </board>
)
`

let hash = ''

function post(body: unknown): Promise<Response> {
  return exportPost(
    new Request('https://pcb-copilot.test/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeAll(async () => {
  const compiled = await runInSandbox(SOURCE, { timeoutMs: 40_000, memoryMb: 512, maxElements: 60_000 })
  const report = evaluateDesign(compiled.circuitJson, compiled.checks, 'prototype-hobby-2layer')
  if (!report.passed) throw new Error('fixture board did not verify; the gate tests would be meaningless')

  const design: DesignResult = {
    slug: 'gate-fixture',
    title: 'Gate fixture',
    summary: 'A two-pin header with a resistor and capacitor in series.',
    tsx: SOURCE,
    circuitJson: compiled.circuitJson,
    checks: report.checks,
    stats: report.stats,
    verified: true,
    blockingCount: report.blockingCount,
    warningCount: report.warningCount,
    iterations: 1,
    model: 'fixture',
    fallbackUsed: false,
    partSearchUsed: false,
    fab: { presetId: report.fabPresetId, label: report.fabPresetLabel, solderMask: 'green', silkscreen: 'white' },
    designHash: 'b'.repeat(40),
    generatedAt: new Date().toISOString(),
    durationMs: compiled.durationMs,
    repairCount: 0,
    tokenUsage: { input: 0, output: 0 },
  }
  hash = (await saveVerifiedDesign(design)).designHash
}, 60_000)

afterEach(() => {
  // The rate limiter is a module-level bucket map; each test starts from a full budget so
  // one test cannot fail another by spending its quota.
  __resetRateLimits()
})

afterAll(() => {
  // The store is an in-process Map; nothing to clean up between test files.
})

describe('the fabrication gate', () => {
  it('refuses a hash the server has never verified', async () => {
    const response = await post({ designHash: 'deadbee', kind: 'fab-zip' })
    expect(response.status).toBe(423)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('CHECKS_FAILED')
  })

  it('refuses a hash-shaped string that is not a hash at all', async () => {
    const response = await post({ designHash: 'not a hash', kind: 'fab-zip' })
    expect(response.status).toBe(400)
  })

  it('refuses source code in place of a hash', async () => {
    const response = await post({ designHash: SOURCE, kind: 'fab-zip' })
    expect(response.status).toBe(400)
  })

  it('refuses a body with no design hash', async () => {
    const response = await post({ kind: 'fab-zip' })
    expect(response.status).toBe(400)
  })

  it('refuses an unknown export kind instead of guessing', async () => {
    const response = await post({ designHash: hash, kind: 'source-map' })
    expect(response.status).toBe(400)
  })
})

describe('the fabrication bundle', () => {
  it('returns a ZIP with a stable filename for a verified design', async () => {
    const response = await post({ designHash: hash, kind: 'fab-zip' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')

    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toMatch(/attachment; filename="[a-z0-9.-]+-fab\.zip"/)
    // A second request must produce the same name: the filename is derived from the slug,
    // the hash and the date, never from a counter or a random id.
    const again = await post({ designHash: hash, kind: 'fab-zip' })
    expect(again.headers.get('content-disposition')).toBe(disposition)
  })

  it('is not cached by a proxy, because it is generated per request', async () => {
    const response = await post({ designHash: hash, kind: 'fab-zip' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('carries a request id so a failure can be traced to a log line', async () => {
    const response = await post({ designHash: hash, kind: 'fab-zip' })
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('individual artefacts', () => {
  it('serves the circuit JSON the server stored, not anything the caller sent', async () => {
    const response = await post({ designHash: hash, kind: 'circuit-json' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ type?: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((element) => element.type === 'pcb_board')).toBe(true)
  })

  it('serves the exact tscircuit source that was compiled', async () => {
    const response = await post({ designHash: hash, kind: 'circuit-tsx' })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<board width="40mm"')
  })

  it('serves a manifest that names the tool versions actually running', async () => {
    const response = await post({ designHash: hash, kind: 'manifest' })
    expect(response.status).toBe(200)
    const manifest = (await response.json()) as { toolVersions: Record<string, string> }
    expect(manifest.toolVersions['@tscircuit/eval']).toBe(TSCIRCUIT_VERSIONS.eval)
  })

  it('serves a BOM and a placement file as CSV', async () => {
    const bom = await post({ designHash: hash, kind: 'bom' })
    expect(bom.headers.get('content-type')).toContain('text/csv')
    expect(await bom.text()).toContain('Designator')

    const pnp = await post({ designHash: hash, kind: 'pnp' })
    expect(pnp.headers.get('content-type')).toContain('text/csv')
    expect(await pnp.text()).toContain('Designator')
  })

  it('serves every Gerber layer as a plain-text file', async () => {
    const response = await post({ designHash: hash, kind: 'gerbers' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toContain('%FSLAX')
    expect(text).toContain('%MOMM')
  })
})
