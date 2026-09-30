import { createHash } from 'node:crypto'

import { evaluateDesign, type CheckReport } from '@/lib/checks'
import { runInSandbox } from '@/lib/server/compile/sandbox'
import { DEFAULT_FAB_PRESET_ID } from '@/lib/server/checks/fab-presets'
import type { GoldenDesign } from '@/designs/golden/designs'

/**
 * Compile one golden design for real and summarise the result.
 *
 * The golden suite deliberately does *not* stub the compiler or the check engine. A golden
 * that passes against mocks only proves the mock is consistent with itself, so the same
 * sandbox the production pipeline uses is what runs here.
 */
export type GoldenResult = {
  id: string
  ok: boolean
  report: CheckReport | null
  fabPresetId: string
  hash: string
  circuitJson: unknown[]
  error: string | null
  durationMs: number
}

/**
 * tscircuit mints some element ids with a random ten-character suffix, for example
 * `source_part_not_found_warning_1gZfWA7CYI`. Those ids carry no design information, so a
 * hash taken over them changes on every run. They are replaced with a stable index derived
 * from the order in which they first appear, which keeps referential integrity intact.
 * Deterministic ids such as `pcb_trace_1` are left exactly as they are.
 */
const RANDOM_ID_SUFFIX = /_([A-Za-z0-9]{10})$/

function canonicalise(value: unknown, randomIds: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalise(entry, randomIds))
  if (value === null || typeof value !== 'object') return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry === undefined) continue
    sorted[key] = key.endsWith('_id') && typeof entry === 'string' && RANDOM_ID_SUFFIX.test(entry)
      ? randomId(entry, randomIds)
      : canonicalise(entry, randomIds)
  }
  return sorted
}

function randomId(id: string, seen: Map<string, string>): string {
  const existing = seen.get(id)
  if (existing) return existing
  const replacement = `<random-${seen.size}>`
  seen.set(id, replacement)
  return replacement
}

/** SHA-256 of the canonical Circuit JSON. */
export function circuitJsonHash(circuitJson: unknown[]): string {
  const canonical = canonicalise(circuitJson, new Map())
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export async function runGolden(
  design: GoldenDesign,
  timeoutMs = 45_000,
): Promise<GoldenResult> {
  const fabPresetId = design.fabPresetId ?? DEFAULT_FAB_PRESET_ID
  const started = Date.now()
  try {
    const sandbox = await runInSandbox(design.source, {
      timeoutMs,
      memoryMb: 512,
      maxElements: 20_000,
    })
    const report = evaluateDesign(sandbox.circuitJson, sandbox.checks, fabPresetId)
    return {
      id: design.id,
      ok: true,
      report,
      fabPresetId,
      hash: circuitJsonHash(sandbox.circuitJson),
      circuitJson: sandbox.circuitJson,
      error: null,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return {
      id: design.id,
      ok: false,
      report: null,
      fabPresetId,
      hash: '',
      circuitJson: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    }
  }
}
