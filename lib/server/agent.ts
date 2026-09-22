import 'server-only'

import type { DesignDiagnostic, DesignResult } from '@/lib/design'

import type { DesignBrief } from './brief'
import type { ServerConfig } from './config'
import { generateInitialCode, repairGeneratedCode } from './generation'
import { compileAndVerify } from './verification'

export type AgentCallbacks = {
  onStage: (message: string) => void
  onCodeChunk?: (chunk: string) => void
  onPartialResult?: (result: DesignResult) => void
  onDiagnostics?: (diagnostics: DesignDiagnostic[]) => void
  signal?: AbortSignal
}

const MAX_REPAIR_ITERATIONS = 3
const TOTAL_TIMEOUT_MS = 240_000

export async function createVerifiedDesign(
  config: ServerConfig,
  brief: DesignBrief,
  callbacks: AgentCallbacks,
): Promise<DesignResult> {
  const startTime = Date.now()
  const abortSignal = callbacks.signal

  function checkAbort() {
    if (abortSignal?.aborted) {
      throw new DOMException('Design generation aborted by client', 'AbortError')
    }
    if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
      throw new Error(`Design generation timed out after ${TOTAL_TIMEOUT_MS / 1000}s. Simplify the board.`)
    }
  }

  callbacks.onStage(`Generating tscircuit TSX with ${config.modelId}`)

  let code = await generateInitialCode(config, brief, {
    signal: abortSignal,
    onChunk: callbacks.onCodeChunk,
  })

  checkAbort()

  let latestDiagnostics: DesignDiagnostic[] = []
  const seenCodes = new Set<string>()
  seenCodes.add(hashCode(code))

  for (let iteration = 1; iteration <= MAX_REPAIR_ITERATIONS + 1; iteration += 1) {
    checkAbort()
    callbacks.onStage(`Compiling and running ERC/DRC — pass ${iteration}`)

    try {
      const result = await compileAndVerify(code, { signal: abortSignal })

      latestDiagnostics = result.diagnostics
      callbacks.onDiagnostics?.(result.diagnostics)

      const designResult: DesignResult = {
        tsx: code,
        circuitJson: result.circuitJson,
        summary: brief.summary,
        assumptions: brief.assumptions,
        diagnostics: result.diagnostics,
        stats: result.stats,
        verified: result.verified,
        iterations: iteration,
        model: config.modelId,
      }

      // Emit partial result for live preview even if not verified
      if (!result.verified || iteration > 1) {
        callbacks.onPartialResult?.(designResult)
      }

      if (result.verified) {
        callbacks.onStage('Verification passed; manufacturing exports unlocked')
        return designResult
      }

      if (iteration > MAX_REPAIR_ITERATIONS) {
        logFailure('verification.loop.exhausted', {
          iterations: iteration,
          blocking: result.diagnostics.filter((item) => item.severity === 'error').length,
          diagnostics: result.diagnostics.slice(0, 10),
        })
        return designResult
      }

      const blockingCount = result.diagnostics.filter((item) => item.severity === 'error').length
      callbacks.onStage(
        blockingCount > 0
          ? `Repairing ${blockingCount} blocking issue(s) with Fireworks`
          : 'No blocking issues; repairing warnings with Fireworks',
      )

      const repaired = await repairGeneratedCode(config, code, result.diagnostics, undefined, {
        signal: abortSignal,
        onChunk: callbacks.onCodeChunk,
      })

      const repairedHash = hashCode(repaired)
      if (seenCodes.has(repairedHash)) {
        logFailure('repair.loop.detected', { iteration, hash: repairedHash })
        // If repair loops, return current best effort
        return designResult
      }
      seenCodes.add(repairedHash)
      code = repaired
    } catch (error) {
      checkAbort()

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      const message = error instanceof Error ? error.message : 'Unknown compiler failure'
      latestDiagnostics = [{ severity: 'error', type: 'compile_error', message }]

      callbacks.onDiagnostics?.(latestDiagnostics)

      if (iteration > MAX_REPAIR_ITERATIONS) {
        logFailure('compiler.rejected.final', { message, iteration })
        throw new Error(message)
      }

      callbacks.onStage(`Compiler rejected pass ${iteration}; requesting a repair`)
      try {
        const repaired = await repairGeneratedCode(config, code, latestDiagnostics, message, {
          signal: abortSignal,
          onChunk: callbacks.onCodeChunk,
        })
        const repairedHash = hashCode(repaired)
        if (seenCodes.has(repairedHash)) {
          throw new Error(message) // Break loop
        }
        seenCodes.add(repairedHash)
        code = repaired
      } catch (repairError) {
        if (repairError instanceof DOMException && repairError.name === 'AbortError') throw repairError
        // If repair itself fails, throw original compilation error
        if (iteration === MAX_REPAIR_ITERATIONS) throw new Error(message)
        // Otherwise try to continue with same code? No, throw
        throw new Error(message)
      }
    }
  }

  throw new Error('The autonomous verification loop ended unexpectedly.')
}

function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `${hash}:${str.length}`
}

function logFailure(message: string, details: Record<string, unknown>) {
  console.error(`[pcb-agent] ${message}`, JSON.stringify(details).slice(0, 2000))
}
