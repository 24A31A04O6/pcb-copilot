import { runAllChecks } from '@tscircuit/checks'
import { runTscircuitCode } from '@tscircuit/eval'
import type { AnyCircuitElement } from 'circuit-json'

import type {
  DesignDiagnostic,
  DesignStats,
  VerificationResult,
} from '@/lib/design'

export function assertSafeGeneratedCode(code: string) {
  const forbidden = [
    /\bimport\s*(?:\(|[^.])/,
    /\brequire\s*\(/,
    /\b(?:process|globalThis|window|document|Deno|Bun)\b/,
    /\b(?:eval|Function|fetch|XMLHttpRequest|WebSocket|Worker)\s*\(/,
    /\b(?:child_process|node:|fs\/promises|filesystem)\b/,
    /__proto__|\.constructor\b/,
  ]

  if (forbidden.some((pattern) => pattern.test(code))) {
    throw new Error('Generated source contained a disallowed runtime capability.')
  }
  if (!/export\s+default/.test(code)) {
    throw new Error('Generated source must export a default circuit component.')
  }
}

export async function compileAndVerify(
  code: string,
): Promise<VerificationResult> {
  assertSafeGeneratedCode(code)

  const circuitJson = (await runTscircuitCode(code)) as AnyCircuitElement[]

  const emittedDiagnostics = circuitJson
    .filter((item) => item.type.includes('error') || item.type.includes('warning'))
    .map(diagnosticFromUnknown)

  const checks = await runAllChecks(circuitJson)

  const diagnostics = dedupeDiagnostics([
    ...emittedDiagnostics,
    ...checks.map(diagnosticFromUnknown),
  ])

  return {
    circuitJson,
    diagnostics,
    stats: computeStats(circuitJson),
    verified: !diagnostics.some((item) => item.severity === 'error'),
  }
}

export function diagnosticFromUnknown(value: unknown): DesignDiagnostic {
  const item = value as Record<string, unknown>
  const type = String(item.type ?? item.error_type ?? 'design_check')
  const message = String(
    item.message ?? item.error_message ?? type.replaceAll('_', ' '),
  )
  return {
    severity: type.toLowerCase().includes('error') ? 'error' : 'warning',
    type,
    message,
  }
}

function dedupeDiagnostics(diagnostics: DesignDiagnostic[]) {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.type}:${diagnostic.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function computeStats(circuitJson: AnyCircuitElement[]): DesignStats {
  const board = circuitJson.find((item) => item.type === 'pcb_board') as
    | Record<string, unknown>
    | undefined
  const width = typeof board?.width === 'number' ? board.width : null
  const height = typeof board?.height === 'number' ? board.height : null

  const layers = new Set<string>()
  for (const item of circuitJson) {
    if (item.type !== 'pcb_trace') continue
    const route = (item as Record<string, unknown>).route
    if (!Array.isArray(route)) continue
    for (const point of route) {
      const layer = (point as Record<string, unknown>).layer
      if (typeof layer === 'string' && layer) layers.add(layer)
    }
  }

  return {
    components: circuitJson.filter((item) => item.type === 'source_component').length,
    sourceTraces: circuitJson.filter((item) => item.type === 'source_trace').length,
    routedTraces: circuitJson.filter((item) => item.type === 'pcb_trace').length,
    pcbLayers: Math.max(layers.size, 1),
    boardWidthMm: width,
    boardHeightMm: height,
  }
}
