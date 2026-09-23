import type { DesignStreamEvent } from '@/lib/design'
import { clientKeyFromRequest, createRateLimitStore } from '@/lib/rate-limit'
import { designRequestSchema } from '@/lib/schemas'
import { createVerifiedDesign } from '@/lib/server/agent'
import { analyzeDesignRequest } from '@/lib/server/brief'
import { getServerConfig } from '@/lib/server/config'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const revalidate = 0
// Fluid Compute: prefer region close to Fireworks (us-west)
export const preferredRegion = ['sfo1', 'iad1']

const rateLimit = createRateLimitStore({ max: 6, windowMs: 10 * 60_000, maxKeys: 2000 })

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const clientKey = clientKeyFromRequest(request)

  if (!rateLimit.allow(clientKey)) {
    return new Response(
      JSON.stringify({
        error: 'Too many design requests. Please wait 2 minutes before trying again.',
        requestId,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '120',
          'X-Request-Id': requestId,
        },
      },
    )
  }

  const parsed = designRequestSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    rateLimit.rollback(clientKey)
    return new Response(
      JSON.stringify({
        error: 'Invalid design conversation. Check message length and count.',
        details: parsed.error.issues.slice(0, 3).map((i) => i.message),
        requestId,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      },
    )
  }

  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch (error) {
    rateLimit.rollback(clientKey)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Server misconfigured.',
        requestId,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      },
    )
  }

  const encoder = new TextEncoder()
  let abortController: AbortController | null = new AbortController()
  const clientSignal = request.signal

  // Link client abort to our controller for Fluid Compute efficiency
  const onClientAbort = () => {
    abortController?.abort()
    console.log(`[design:${requestId}] client aborted`)
  }
  clientSignal.addEventListener('abort', onClientAbort, { once: true })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: DesignStreamEvent) => {
        try {
          if (controller.desiredSize === null) return // closed
          const withTimestamp = { ...event, timestamp: Date.now() } as DesignStreamEvent & { timestamp: number }
          controller.enqueue(encoder.encode(`${JSON.stringify(withTimestamp)}\n`))
        } catch {
          // Controller may be closed
        }
      }

      try {
        send({ type: 'stage', message: 'Reviewing requirements with Fireworks' })

        const brief = await analyzeDesignRequest(
          config,
          parsed.data.messages,
          parsed.data.allowClarification,
          { signal: abortController!.signal },
        )

        if (brief.status === 'needs_clarification' && brief.questions.length > 0) {
          rateLimit.rollback(clientKey) // Allow retry without penalty
          send({ type: 'clarification', questions: brief.questions })
          return
        }

        let codeBuffer = ''

        const design = await createVerifiedDesign(config, brief, {
          signal: abortController!.signal,
          onStage: (message) => send({ type: 'stage', message }),
          onCodeChunk: (chunk) => {
            codeBuffer += chunk
            // Throttle code_chunk events to avoid overwhelming client
            if (codeBuffer.length % 100 < chunk.length) {
              send({ type: 'code_chunk', chunk })
            }
          },
          onPartialResult: (partial) => {
            // Send partial results for live preview
            send({ type: 'partial_result', design: partial })
            send({ type: 'diagnostics', diagnostics: partial.diagnostics })
          },
          onDiagnostics: (diagnostics) => {
            send({ type: 'diagnostics', diagnostics })
          },
        })

        // Final code
        if (codeBuffer.length > 0) {
          send({ type: 'code', code: design.tsx })
        }

        send({ type: 'result', design })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log(`[design:${requestId}] aborted`)
          // Don't send error if client aborted, just close
          try {
            controller.close()
          } catch {}
          return
        }
        const message = error instanceof Error ? error.message : 'PCB generation failed.'
        console.error(`[design:${requestId}] error:`, message)
        send({
          type: 'error',
          message,
        })
      } finally {
        try {
          controller.close()
        } catch {}
        abortController = null
        clientSignal.removeEventListener('abort', onClientAbort)
      }
    },
    cancel() {
      // Client cancelled stream reading
      abortController?.abort()
      console.log(`[design:${requestId}] stream cancelled by client`)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
      'X-Accel-Buffering': 'no', // Disable nginx buffering for live stream
      Connection: 'keep-alive',
    },
  })
}
