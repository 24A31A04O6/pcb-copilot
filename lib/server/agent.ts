import 'server-only'

import type { DesignDiagnostic, DesignResult } from '@/lib/design'

import type { DesignBrief } from './brief'
import type { ServerConfig } from './config'
import { generateInitialCode, repairGeneratedCode } from './generation'
import { compileAndVerify } from './verification'

export type AgentCallbacks = {
  onStage: (message: string) => void
}

const MAX_REPAIR_ITERATIONS = 3

export async function createVerifiedDesign(
  config: ServerConfig,
  brief: DesignBrief,
  callbacks: AgentCallbacks,
): Promise<DesignResult> {
  callbacks.onStage(`Generating tscircuit TSX with ${config.modelId}`)
  let code = await generateInitialCode(config, brief)
  let latestDiagnostics: DesignDiagnostic[] = []

  for (let iteration = 1; iteration <= MAX_REPAIR_ITERATIONS + 1; iteration += 1) {
    callbacks.onStage(`Compiling and running ERC/DRC — pass ${iteration}`)

    try {
      const result = await compileAndVerify(code)
      latestDiagnostics = result.diagnostics

      if (result.verified) {
        callbacks.onStage('Verification passed; manufacturing exports unlocked')
        return {
          tsx: code,
          circuitJson: result.circuitJson,
          summary: brief.summary,
          assumptions: brief.assumptions,
          diagnostics: result.diagnostics,
          stats: result.stats,
          verified: true,
          iterations: iteration,
          model: config.modelId,
        }
      }

      if (iteration > MAX_REPAIR_ITERATIONS) {
        logFailure('verification.loop.exhausted', {
          iterations: iteration,
          blocking: result.diagnostics.filter((item) => item.severity === 'error').length,
          diagnostics: result.diagnostics,
        })
        return {
          tsx: code,
          circuitJson: result.circuitJson,
          summary: brief.summary,
          assumptions: brief.assumptions,
          diagnostics: result.diagnostics,
          stats: result.stats,
          verified: false,
          iterations: iteration,
          model: config.modelId,
        }
      }

      const blockingCount = result.diagnostics.filter(
        (item) => item.severity === 'error',
      ).length
      callbacks.onStage(
        blockingCount > 0
          ? `Repairing ${blockingCount} blocking issue(s) with Fireworks`
          : 'No blocking issues; repairing warnings with Fireworks',
      )
      code = await repairGeneratedCode(config, code, result.diagnostics)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown compiler failure'
      latestDiagnostics = [
        { severity: 'error', type: 'compile_error', message },
      ]
      if (iteration > MAX_REPAIR_ITERATIONS) {
        logFailure('compiler.rejected.final', { message, iteration })
        throw new Error(message)
      }
      callbacks.onStage(`Compiler rejected pass ${iteration}; requesting a repair`)
      code = await repairGeneratedCode(config, code, latestDiagnostics, message)
    }
  }

  throw new Error('The autonomous verification loop ended unexpectedly.')
}

function logFailure(message: string, details: Record<string, unknown>) {
  console.error(`[pcb-agent] ${message}`, details)
}
