import type { DesignDiagnostic } from '@/lib/design'

import type { DesignBrief } from './brief'
import type { ServerConfig } from './config'
import { requestFireworks } from './fireworks'
import { SYSTEM_PROMPT } from './prompts'

const MAX_CODE_LENGTH = 80_000

export async function generateInitialCode(
  config: ServerConfig,
  brief: DesignBrief,
): Promise<string> {
  const text = await requestFireworks(
    config,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Create the complete PCB design now.

Summary: ${brief.summary}
Requirements:
${brief.requirements.map((item) => `- ${item}`).join('\n')}
Assumptions:
${brief.assumptions.map((item) => `- ${item}`).join('\n')}`,
      },
    ],
    { timeoutMs: 120_000, maxTokens: 8_192 },
  )
  return extractTsx(text)
}

export async function repairGeneratedCode(
  config: ServerConfig,
  code: string,
  diagnostics: DesignDiagnostic[],
  compileFailure?: string,
): Promise<string> {
  const diagnosticLines =
    diagnostics
      .map((item) => `- [${item.severity}] ${item.type}: ${item.message}`)
      .join('\n') || '- none'

  const text = await requestFireworks(
    config,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Repair this tscircuit design. Preserve its intended function, but fix every compiler, connectivity, placement, and routing failure. Return the full corrected TSX module only.

Compiler failure: ${compileFailure ?? 'none'}
Diagnostics:
${diagnosticLines}

Current source:
${code}`,
      },
    ],
    { timeoutMs: 120_000, maxTokens: 8_192 },
  )
  return extractTsx(text)
}

export function extractTsx(text: string) {
  const fenced = text.match(/```(?:tsx|typescript|jsx|ts)?\s*([\s\S]*?)```/i)
  const code = (fenced?.[1] ?? text).trim()
  if (!code) throw new Error('Fireworks returned empty circuit source.')
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error('Generated circuit source is too large.')
  }
  return code
}
