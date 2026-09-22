import { z } from 'zod'

import type { ServerConfig } from './config'
import { requestFireworks } from './fireworks'

const designBriefSchema = z.object({
  status: z.enum(['ready', 'needs_clarification']),
  questions: z.array(z.string()).max(5),
  summary: z.string(),
  assumptions: z.array(z.string()).max(20),
  requirements: z.array(z.string()).max(40),
})

export type DesignBrief = z.infer<typeof designBriefSchema>

/**
 * Parse a Fireworks JSON response into a DesignBrief with a fallback so a
 * slightly malformed or fenced response degrades gracefully instead of
 * throwing.
 */
export function parseDesignBrief(raw: string): DesignBrief {
  const parsed = designBriefSchema.safeParse(JSON.parse(extractJson(raw)))
  if (parsed.success) return parsed.data

  const partial = designBriefSchema.partial().safeParse(JSON.parse(extractJson(raw)))
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
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? raw).trim()
}

export async function analyzeDesignRequest(
  config: ServerConfig,
  messages: string[],
  allowClarification: boolean,
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
      questions: { type: 'array', maxItems: 5, items: { type: 'string' } },
      summary: { type: 'string' },
      assumptions: { type: 'array', maxItems: 20, items: { type: 'string' } },
      requirements: { type: 'array', maxItems: 40, items: { type: 'string' } },
    },
  }

  const clarificationInstruction = allowClarification
    ? 'This is the only opportunity to ask clarification questions. If the brief is missing information that materially affects safety or function, set status to needs_clarification and list the questions.'
    : 'Clarification was already requested. Do not ask any more questions. Set status to ready and make conservative, explicit engineering assumptions for missing details.'

  const content = await requestFireworks(
    config,
    [
      {
        role: 'system',
        content:
          'You are a senior PCB requirements engineer. Return JSON matching the supplied schema exactly.',
      },
      {
        role: 'user',
        content: `Review this PCB design conversation and produce a complete engineering brief.

${clarificationInstruction}

Ask only critical questions that materially change safety or function: supply voltage/range, maximum current, required interfaces, board dimensions/connector constraints, load characteristics, or exact controller when relevant. Do not ask cosmetic questions. If earlier messages answer a question, do not ask it again.

Conversation:
${messages.map((message, index) => `${index + 1}. ${message}`).join('\n')}`,
      },
    ],
    {
      timeoutMs: 90_000,
      maxTokens: 2_048,
      jsonSchema: schema,
    },
  )

  const brief = parseDesignBrief(content)

  if (!allowClarification) {
    return { ...brief, status: 'ready', questions: [] }
  }
  return brief
}
