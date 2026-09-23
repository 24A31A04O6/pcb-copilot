import { z } from 'zod'

import type { ServerConfig } from './config'
import { requestFireworks } from './fireworks'

const designBriefSchema = z.object({
  status: z.enum(['ready', 'needs_clarification']),
  questions: z.array(z.string().min(1).max(300)).max(5),
  summary: z.string().min(1).max(2000),
  assumptions: z.array(z.string().min(1).max(500)).max(20),
  requirements: z.array(z.string().min(1).max(500)).max(40),
})

export type DesignBrief = z.infer<typeof designBriefSchema>

/**
 * Parse a Fireworks JSON response into a DesignBrief with robust fallback.
 */
export function parseDesignBrief(raw: string): DesignBrief {
  const jsonStr = extractJson(raw)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(jsonStr)
  } catch {
    // Try to repair common JSON issues: trailing commas, single quotes
    try {
      const repaired = jsonStr
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/'/g, '"')
      parsedJson = JSON.parse(repaired)
    } catch {
      throw new Error('Fireworks returned invalid JSON for design brief.')
    }
  }

  const parsed = designBriefSchema.safeParse(parsedJson)
  if (parsed.success) return parsed.data

  const partial = designBriefSchema.partial().safeParse(parsedJson)
  if (!partial.success) {
    throw new Error('Fireworks returned an invalid design brief.')
  }

  const data = partial.data
  return {
    status: 'ready',
    questions: [],
    summary: data.summary ?? 'Generated PCB design',
    assumptions: data.assumptions ?? ['Key parameters unspecified; conservative defaults assumed.'],
    requirements: data.requirements ?? ['Generate a manufacturable PCB for the described board.'],
  }
}

function extractJson(raw: string) {
  const trimmed = raw.trim()
  // Handle fenced JSON
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  // Find first { and last } to extract JSON object
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

export async function analyzeDesignRequest(
  config: ServerConfig,
  messages: string[],
  allowClarification: boolean,
  opts?: { signal?: AbortSignal },
): Promise<DesignBrief> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'questions', 'summary', 'assumptions', 'requirements'],
    properties: {
      status: {
        type: 'string',
        enum: allowClarification ? ['ready', 'needs_clarification'] : ['ready'],
      },
      questions: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 300 } },
      summary: { type: 'string', minLength: 1, maxLength: 2000 },
      assumptions: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 500 } },
      requirements: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 500 } },
    },
  }

  const clarificationInstruction = allowClarification
    ? 'This is the ONLY opportunity to ask clarification questions. If the brief is missing information that materially affects safety or function, set status to needs_clarification and list up to 5 critical questions.'
    : 'Clarification was already requested. Do NOT ask any more questions. Set status to ready and make conservative, explicit engineering assumptions for missing details.'

  const conversation = messages
    .slice(-10) // Only last 10 messages to save tokens
    .map((message, index) => `${index + 1}. ${message.slice(0, 1000)}`)
    .join('\n')

  const content = await requestFireworks(
    config,
    [
      {
        role: 'system',
        content:
          'You are a senior PCB requirements engineer. Return JSON matching the supplied schema exactly. Be concise but thorough. Prioritize safety and manufacturability.',
      },
      {
        role: 'user',
        content: `Review this PCB design conversation and produce a complete engineering brief.

${clarificationInstruction}

Ask ONLY critical questions that materially change safety or function: supply voltage/range, maximum current, required interfaces, board dimensions/connector constraints, load characteristics, or exact controller when relevant. Do not ask cosmetic questions. If earlier messages answer a question, do not ask it again.

Conversation:
${conversation}`,
      },
    ],
    {
      timeoutMs: 60_000,
      maxTokens: 2_048,
      jsonSchema: schema,
      signal: opts?.signal,
      retries: 1,
    },
  )

  const brief = parseDesignBrief(content)

  if (!allowClarification) {
    return { ...brief, status: 'ready', questions: [] }
  }

  // If questions are too vague, treat as ready
  if (brief.status === 'needs_clarification' && brief.questions.length === 0) {
    return { ...brief, status: 'ready' }
  }

  return brief
}
