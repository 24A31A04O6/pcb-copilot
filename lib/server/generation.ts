import type { DesignDiagnostic } from '@/lib/design'

import type { DesignBrief } from './brief'
import type { ServerConfig } from './config'
import { requestFireworks, requestFireworksStream } from './fireworks'
import { SYSTEM_PROMPT } from './prompts'

const MAX_CODE_LENGTH = 80_000
const MIN_CODE_LENGTH = 20

export type GenerationCallbacks = {
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
}

export async function generateInitialCode(
  config: ServerConfig,
  brief: DesignBrief,
  callbacks?: GenerationCallbacks,
): Promise<string> {
  const prompt = `Create the complete PCB design now.

Summary: ${brief.summary}
Requirements:
${brief.requirements.map((item) => `- ${item}`).join('\n')}
Assumptions:
${brief.assumptions.map((item) => `- ${item}`).join('\n')}

Return ONLY the TSX module, no explanation.`

  let fullText = ''
  const text = await requestFireworksStream(
    config,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    {
      timeoutMs: 120_000,
      maxTokens: 8_192,
      signal: callbacks?.signal,
      onChunk: (chunk) => {
        fullText += chunk
        callbacks?.onChunk?.(chunk)
      },
    },
  )

  // If streaming didn't trigger callback (fallback), use returned text
  const source = fullText.length > 0 ? fullText : text
  return extractTsx(source)
}

export async function repairGeneratedCode(
  config: ServerConfig,
  code: string,
  diagnostics: DesignDiagnostic[],
  compileFailure?: string,
  callbacks?: GenerationCallbacks,
): Promise<string> {
  const diagnosticLines =
    diagnostics
      .slice(0, 20)
      .map((item) => `- [${item.severity}] ${item.type}: ${item.message}`)
      .join('\n') || '- none'

  const prompt = `Repair this tscircuit design. Preserve its intended function, but fix every compiler, connectivity, placement, and routing failure. Return the full corrected TSX module only.

Compiler failure: ${compileFailure ?? 'none'}
Diagnostics:
${diagnosticLines}

Current source:
${code.slice(0, 30_000)}`

  let fullText = ''
  const text = await requestFireworks(
    config,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    { timeoutMs: 120_000, maxTokens: 8_192, signal: callbacks?.signal },
  )

  // For repair, we use non-streaming for stability, but still support chunk callback via streaming if needed
  // If you want streaming repair, switch to requestFireworksStream
  if (callbacks?.onChunk) {
    // Simulate chunking for UI liveness
    const chunks = chunkString(text, 50)
    for (const c of chunks) {
      callbacks.onChunk(c)
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  return extractTsx(fullText.length > 0 ? fullText : text)
}

export function extractTsx(text: string) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Fireworks returned empty circuit source.')

  // Handle multiple fence types, prefer last large block (often the final code)
  const fenceRegex = /```(?:tsx|typescript|jsx|ts)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let lastCode: string | null = null
  let largestCode: string | null = null

  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const code = match[1].trim()
    if (code) {
      lastCode = code
      if (!largestCode || code.length > largestCode.length) {
        largestCode = code
      }
    }
  }

  // Prefer largest fenced block, fallback to last, then full text
  let code = largestCode ?? lastCode ?? trimmed

  // If still contains fences markers inside, strip them
  code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()

  // Remove any leading explanation before export default
  const exportIndex = code.indexOf('export default')
  if (exportIndex > 0 && exportIndex < 500) {
    // If there's a lot of text before export default, trim to export
    const before = code.slice(0, exportIndex)
    if (before.split('\n').length > 3 && !before.includes('<board')) {
      code = code.slice(exportIndex)
    }
  }

  if (!code) throw new Error('Fireworks returned empty circuit source.')
  if (code.length < MIN_CODE_LENGTH) {
    throw new Error('Generated circuit source is too short.')
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`Generated circuit source is too large (${code.length} chars > ${MAX_CODE_LENGTH}).`)
  }

  return code
}

function chunkString(str: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size))
  }
  return chunks
}
