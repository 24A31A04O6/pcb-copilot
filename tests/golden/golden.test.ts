/**
 * The golden design corpus.
 *
 * Each design is compiled for real, checked against the default fabrication preset and
 * hashed. This is the regression net for the whole path from generated TSX to fab output:
 * a tscircuit upgrade that changes pin labelling, autorouting or courtyard geometry fails
 * here first, with a diff of what moved.
 *
 * The suite is slow by construction (roughly 2-3 s per board, since every design spawns the
 * isolated compiler). It runs in CI, not on every keystroke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GOLDEN_DESIGNS } from '@/designs/golden/designs'
import { runGolden, type GoldenResult } from '@/lib/goldens/run'

const results = new Map<string, GoldenResult>()

beforeAll(async () => {
  // Sequential on purpose: each sandbox is memory-capped, and running 23 of them at once
  // on a CI runner is the fastest way to turn a timing bug into a flaky suite.
  for (const design of GOLDEN_DESIGNS) {
    results.set(design.id, await runGolden(design))
  }
}, 600_000)

afterAll(() => {
  results.clear()
})

describe('golden designs', () => {
  it('covers 15 to 25 boards, as Phase 7 requires', () => {
    expect(GOLDEN_DESIGNS.length).toBeGreaterThanOrEqual(15)
    expect(GOLDEN_DESIGNS.length).toBeLessThanOrEqual(25)
  })

  it('gives every design a unique id, a brief and a hash', () => {
    const ids = new Set(GOLDEN_DESIGNS.map((d) => d.id))
    expect(ids.size).toBe(GOLDEN_DESIGNS.length)
    for (const design of GOLDEN_DESIGNS) {
      expect(design.brief.length).toBeGreaterThan(20)
      expect(design.proves.length).toBeGreaterThan(20)
      expect(design.expected.hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  for (const design of GOLDEN_DESIGNS) {
    describe(design.title, () => {
      const result = () => results.get(design.id)

      it('compiles without an error', () => {
        const r = result()
        expect(r, `${design.id} was never run`).toBeDefined()
        expect(r!.ok, r!.error ?? '').toBe(true)
      })

      it('clears the fabrication gate', () => {
        const report = result()!.report
        const blocking = report!.checks.filter((c) => c.severity === 'error')
        expect(
          blocking.map((c) => `${c.code}: ${c.message}`),
          `${design.title} is blocked from export`,
        ).toEqual([])
        expect(report!.passed).toBe(true)
      })

      it(`lays out a ${design.expected.boardWidthMm}x${design.expected.boardHeightMm} mm, ` +
        `${design.expected.layers}-layer board with the parts it claims`, () => {
        const stats = result()!.report!.stats
        expect(stats.boardWidthMm).toBeCloseTo(design.expected.boardWidthMm, 3)
        expect(stats.boardHeightMm).toBeCloseTo(design.expected.boardHeightMm, 3)
        expect(stats.pcbLayers).toBe(design.expected.layers)
        expect(stats.components).toBeGreaterThanOrEqual(design.expected.minComponents)
        expect(stats.routedTraces).toBeGreaterThanOrEqual(design.expected.minTraces)
      })

      it('produces the same Circuit JSON every time', async () => {
        // Re-running one board per test file would double the suite cost for a property the
        // hash already encodes, so a single spot-check design stands in for the rest.
        if (design.id !== 'rc-led-blinker') return
        const again = await runGolden(design)
        expect(again.ok, again.error ?? '').toBe(true)
        expect(again.hash).toBe(design.expected.hash)
      })

      it('matches its recorded hash', () => {
        const r = result()!
        expect(
          r.hash,
          'Circuit JSON changed. Re-run `pnpm run golden:hash` and review the diff before accepting it.',
        ).toBe(design.expected.hash)
      })
    })
  }
})
