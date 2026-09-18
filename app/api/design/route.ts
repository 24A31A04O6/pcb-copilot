import { NextRequest } from 'next/server'
import { z } from 'zod'

import type { DesignStreamEvent } from '@/lib/design'
import {
  analyzeDesignRequest,
  createVerifiedDesign,
} from '@/lib/server/pcb-agent'

export const runtime = 'nodejs'
export const maxDuration = 300

const requestSchema = z.object({
  messages: z.array(z.string().trim().min(1).max(4_000)).min(1).max(20),
})

const requests = new Map<string, number[]>()

function enforceRateLimit(request: NextRequest) {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const now = Date.now()
  const recent = (requests.get(key) ?? []).filter((time) => now - time < 10 * 60_000)
  if (recent.length >= 6) return false
  recent.push(now)
  requests.set(key, recent)
  return true
}

export async function POST(request: NextRequest) {
  if (!enforceRateLimit(request)) {
    return Response.json(
      { error: 'Too many design requests. Please wait before trying again.' },
      { status: 429 },
    )
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid design conversation.' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: DesignStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

      void (async () => {
        try {
          send({ type: 'stage', message: 'Reviewing requirements with Gemini' })
          const brief = await analyzeDesignRequest(parsed.data.messages)

          if (brief.status === 'needs_clarification' && brief.questions.length > 0) {
            send({ type: 'clarification', questions: brief.questions })
            return
          }

          const design = await createVerifiedDesign(brief, {
            onStage: (message) => send({ type: 'stage', message }),
          })
          send({ type: 'result', design })
        } catch (error) {
          send({
            type: 'error',
            message: error instanceof Error ? error.message : 'PCB generation failed.',
          })
        } finally {
          controller.close()
        }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
