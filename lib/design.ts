import type { Check, CheckReport, DesignStats } from '@/lib/checks'
import type { ErrorCode } from '@/lib/errors'

export type { Check, CheckReport, DesignStats }

export type CircuitJson = unknown[]

export type FabChoice = {
  presetId: string
  label: string
  solderMask: string
  silkscreen: string
}

export type DesignResult = {
  /** Short, URL-safe slug derived from the title. */
  slug: string
  title: string
  summary: string
  tsx: string
  circuitJson: CircuitJson
  checks: Check[]
  stats: DesignStats
  verified: boolean
  blockingCount: number
  warningCount: number
  iterations: number
  model: string
  fallbackUsed: boolean
  /**
   * Whether a distributor catalogue was actually consulted for this design.
   *
   * `false` means the part numbers, if any, came from the model's own memory and have not
   * been checked against stock, price or package. The UI says so; a design never claims a
   * part was verified when no catalogue was reachable.
   */
  partSearchUsed: boolean
  fab: FabChoice
  /** Deterministic cache/permalink key. */
  designHash: string
  generatedAt: string
  durationMs: number
  repairCount: number
  tokenUsage: { input: number; output: number }
}

export type PipelineStage =
  | 'queued'
  | 'brief'
  | 'codegen'
  | 'compile'
  | 'checks'
  | 'repair'
  | 'done'
  | 'error'

/** `Omit` that distributes over a union, so event shapes stay intact. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A pipeline event before the server stamps its SSE id. */
export type PipelineEventWithoutId = DistributiveOmit<PipelineEvent, 'id'>

/** Server-Sent Events emitted by `POST /api/design`. */
export type PipelineEvent =
  | { event: 'brief'; id: number; data: { title: string; summary: string; brief: unknown } }
  | { event: 'codegen'; id: number; data: { chunk?: string; bytes: number } }
  | { event: 'compile'; id: number; data: { attempt: number; durationMs?: number; ok: boolean } }
  | { event: 'checks'; id: number; data: { report: CheckReport } }
  | { event: `repair#${number}`; id: number; data: { iteration: number; reasons: string[] } }
  | { event: 'stage'; id: number; data: { stage: PipelineStage; label: string; detail?: string } }
  | { event: 'log'; id: number; data: { level: 'info' | 'warn'; message: string; at: number } }
  | { event: 'done'; id: number; data: { design: DesignResult } }
  | {
      event: 'error'
      id: number
      data: { code: ErrorCode; message: string; retryable: boolean; requestId: string; details?: string[] }
    }

export function categorizeChecks(checks: Check[]) {
  const errors = checks.filter((check) => check.severity === 'error')
  const warnings = checks.filter((check) => check.severity === 'warning')
  const bySeverity: Record<string, Check[]> = {}
  for (const check of checks) {
    ;(bySeverity[check.severity] ??= []).push(check)
  }
  const byCode: Record<string, Check[]> = {}
  for (const check of checks) {
    ;(byCode[check.code] ??= []).push(check)
  }
  return { errors, warnings, bySeverity, byCode, total: checks.length }
}
