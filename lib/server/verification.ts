import { runAllChecks } from '@tscircuit/checks'
import { runTscircuitCode } from '@tscircuit/eval'
import type { AnyCircuitElement } from 'circuit-json'

import type { DesignDiagnostic, DesignStats, VerificationResult } from '@/lib/design'

const COMPILE_TIMEOUT_MS = 30_000
const CHECKS_TIMEOUT_MS = 15_000
const MAX_CIRCUIT_ELEMENTS = 100_000

export function assertSafeGeneratedCode(code: string) {
  // Block dangerous runtime capabilities with precise checks
  const forbiddenPatterns: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /^\s*import\s+.*from\s+['"]/m, message: 'import statements not allowed' },
    { pattern: /\bimport\s*\(/, message: 'dynamic import() not allowed' },
    { pattern: /\brequire\s*\(/, message: 'require() not allowed' },
    { pattern: /\bprocess\.(env|exit|argv)/, message: 'process access not allowed' },
    { pattern: /\bglobalThis\b/, message: 'globalThis access not allowed' },
    { pattern: /\b(?:window|document)\s*\./, message: 'DOM access not allowed' },
    { pattern: /\bDeno\b/, message: 'Deno not allowed' },
    { pattern: /\bBun\b/, message: 'Bun not allowed' },
    { pattern: /\beval\s*\(/, message: 'eval() not allowed' },
    { pattern: /\bFunction\s*\(/, message: 'Function() not allowed' },
    { pattern: /\bfetch\s*\(/, message: 'fetch() not allowed' },
    { pattern: /\bXMLHttpRequest\b/, message: 'XMLHttpRequest not allowed' },
    { pattern: /\bWebSocket\s*\(/, message: 'WebSocket not allowed' },
    { pattern: /\bWorker\s*\(/, message: 'Worker not allowed' },
    { pattern: /child_process/, message: 'child_process not allowed' },
    { pattern: /fs\/promises/, message: 'fs/promises not allowed' },
    { pattern: /__proto__/, message: '__proto__ access not allowed' },
    { pattern: /\.constructor\s*\[/, message: 'constructor access not allowed' },
  ]

  for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(code)) {
      throw new Error(`Generated source contained disallowed capability: ${message}.`)
    }
  }

  if (!/export\s+default/.test(code)) {
    throw new Error('Generated source must export a default circuit component.')
  }

  // Check for excessively long lines that might indicate obfuscation
  const lines = code.split('\n')
  for (const line of lines) {
    if (line.length > 2000) {
      throw new Error('Generated source contains an excessively long line.')
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise
      .then((v) => {
        clearTimeout(id)
        resolve(v)
      })
      .catch((e) => {
        clearTimeout(id)
        reject(e)
      })
  })
}

export async function compileAndVerify(
  code: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<VerificationResult> {
  if (opts?.signal?.aborted) {
    throw new DOMException('Compilation aborted', 'AbortError')
  }

  assertSafeGeneratedCode(code)

  const compileTimeout = opts?.timeoutMs ?? COMPILE_TIMEOUT_MS

  let circuitJson: AnyCircuitElement[]
  try {
    const compilePromise = runTscircuitCode(code) as Promise<AnyCircuitElement[]>
    circuitJson = await withTimeout(compilePromise, compileTimeout, 'Circuit compilation')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown compiler failure'
    // Enhance error message for common failures
    if (message.includes('timed out')) {
      throw new Error(`Circuit compilation timed out (${compileTimeout}ms). Simplify the design.`)
    }
    throw new Error(message)
  }

  if (!Array.isArray(circuitJson)) {
    throw new Error('Compiler did not return a valid circuit JSON array.')
  }

  if (circuitJson.length > MAX_CIRCUIT_ELEMENTS) {
    throw new Error(
      `Circuit too large: ${circuitJson.length} elements exceeds limit of ${MAX_CIRCUIT_ELEMENTS}. Simplify the board.`,
    )
  }

  if (opts?.signal?.aborted) {
    throw new DOMException('Verification aborted', 'AbortError')
  }

  const emittedDiagnostics = circuitJson
    .filter((item) => {
      const t = (item as { type?: string }).type ?? ''
      return t.includes('error') || t.includes('warning')
    })
    .map(diagnosticFromUnknown)
    .slice(0, 100) // Cap diagnostics to prevent UI overload

  let checks: unknown[] = []
  try {
    const checksPromise = runAllChecks(circuitJson as any)
    checks = (await withTimeout(checksPromise, CHECKS_TIMEOUT_MS, 'Design checks')) as unknown[]
  } catch (error) {
    // Checks failure shouldn't block verification, but log as warning
    const msg = error instanceof Error ? error.message : 'Design checks failed'
    emittedDiagnostics.push({
      severity: 'warning',
      type: 'check_error',
      message: `Automated checks partially failed: ${msg}. Review manually.`,
    })
  }

  const checkDiagnostics = (checks as unknown[])
    .map(diagnosticFromUnknown)
    .slice(0, 100)

  const diagnostics = dedupeDiagnostics([...emittedDiagnostics, ...checkDiagnostics]).slice(0, 150)

  return {
    circuitJson,
    diagnostics,
    stats: computeStats(circuitJson),
    verified: !diagnostics.some((item) => item.severity === 'error'),
  }
}

export function diagnosticFromUnknown(value: unknown): DesignDiagnostic {
  const item = value as Record<string, unknown>
  const type = String(item.type ?? item.error_type ?? item.code ?? 'design_check')
  const message = String(
    item.message ?? item.error_message ?? item.error ?? type.replaceAll('_', ' '),
  ).slice(0, 500) // Cap message length

  const lowerType = type.toLowerCase()
  const lowerMsg = message.toLowerCase()
  const isError =
    lowerType.includes('error') ||
    lowerMsg.includes('error') ||
    (item as any).severity === 'error' ||
    lowerType.includes('fail')

  return {
    severity: isError ? 'error' : 'warning',
    type: type.slice(0, 100),
    message,
  }
}

function dedupeDiagnostics(diagnostics: DesignDiagnostic[]) {
  const seen = new Set<string>()
  const result: DesignDiagnostic[] = []
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.type}:${diagnostic.message}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }
  return result
}

function computeStats(circuitJson: AnyCircuitElement[]): DesignStats {
  let components = 0
  let sourceTraces = 0
  let routedTraces = 0
  const layers = new Set<string>()
  let width: number | null = null
  let height: number | null = null

  for (const item of circuitJson) {
    const type = (item as { type?: string }).type
    if (type === 'source_component') components++
    else if (type === 'source_trace') sourceTraces++
    else if (type === 'pcb_trace') {
      routedTraces++
      const route = (item as Record<string, unknown>).route
      if (Array.isArray(route)) {
        for (const point of route) {
          const layer = (point as Record<string, unknown>).layer
          if (typeof layer === 'string' && layer) layers.add(layer)
        }
      }
    } else if (type === 'pcb_board') {
      const board = item as Record<string, unknown>
      if (typeof board.width === 'number') width = board.width
      if (typeof board.height === 'number') height = board.height
    }
  }

  return {
    components,
    sourceTraces,
    routedTraces,
    pcbLayers: Math.max(layers.size, 1),
    boardWidthMm: width,
    boardHeightMm: height,
  }
}
