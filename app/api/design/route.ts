import type { DesignStreamEvent } from '@/lib/design'
import { clientKeyFromRequest, createRateLimitStore } from '@/lib/rate-limit'
import { designRequestSchema } from '@/lib/schemas'
import { createVerifiedDesign } from '@/lib/server/agent'
import { analyzeDesignRequest } from '@/lib/server/brief'
import { getServerConfig } from '@/lib/server/config'

export const runtime = 'nodejs'
export const maxDuration = 300

const rateLimit = createRateLimitStore({ max: 6, windowMs: 10 * 60_000 })

export async function POST(request: Request) {
  const clientKey = clientKeyFromRequest(request)

  if (!rateLimit.allow(clientKey)) {
    return new Response(
      JSON.stringify({
        error: 'Too many design requests. Please wait before trying again.',
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const parsed = designRequestSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    rateLimit.clear(clientKey)
    return new Response(JSON.stringify({ error: 'Invalid design conversation.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch (error) {
    rateLimit.clear(clientKey)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Server misconfigured.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: DesignStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

      void (async () => {
        try {
          send({ type: 'stage', message: 'Reviewing requirements with Fireworks' })
          const brief = await analyzeDesignRequest(
            config,
            parsed.data.messages,
            parsed.data.allowClarification,
          )

          if (brief.status === 'needs_clarification' && brief.questions.length > 0) {
            rateLimit.clear(clientKey)
            send({ type: 'clarification', questions: brief.questions })
            return
          }

          const design = await createVerifiedDesign(config, brief, {
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
