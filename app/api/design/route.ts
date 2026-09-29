import { isBoardColorId } from '@/lib/board-colors'
import type { PipelineEvent } from '@/lib/design'
import { toAppError, toClientError } from '@/lib/errors'
import { rateLimitDesign } from '@/lib/server/rate-limit'
import { designRequestSchema } from '@/lib/schemas'
import { isFabPresetId } from '@/lib/server/checks/fab-presets'
import { getServerConfig } from '@/lib/server/env'
import { runPipeline } from '@/lib/server/pipeline'
import { createDesignCache, saveVerifiedDesign } from '@/lib/server/store'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The design cache is module-scoped, so a warm instance serves an identical brief
 * instantly. It is bounded, and every entry is also written to Redis when configured.
 */
const cache = createDesignCache(50)

function sse(event: PipelineEvent): Uint8Array {
  return new TextEncoder().encode(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
}

function comment(text: string): Uint8Array {
  return new TextEncoder().encode(`: ${text}\n\n`)
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const started = Date.now()

  const body = (await request.json().catch(() => null)) as unknown
  const parsed = designRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        ...toClientError(
          toAppError(new Error('input')),
          requestId,
        ),
        code: 'INPUT_INVALID',
        message: 'That brief could not be used. Keep it under 4000 characters.',
        details: parsed.error.issues.slice(0, 4).map((issue) => issue.message),
      },
      { status: 400, headers: { 'X-Request-Id': requestId } },
    )
  }

  const limit = await rateLimitDesign(request)
  if (!limit.allowed) {
    return Response.json(
      {
        code: 'RATE_LIMITED',
        message: `Too many designs from this address. Try again in ${limit.retryAfterSeconds}s.`,
        retryable: true,
        requestId,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds), 'X-Request-Id': requestId },
      },
    )
  }

  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch (error) {
    return Response.json(
      {
        code: 'LLM_MISCONFIGURED',
        message: 'The server is missing model configuration. Check the deployment environment.',
        retryable: false,
        requestId,
        details: error instanceof Error ? [error.message.split('\n')[0] ?? ''] : [],
      },
      { status: 500, headers: { 'X-Request-Id': requestId } },
    )
  }

  const boardColorId = isBoardColorId(parsed.data.boardColor) ? parsed.data.boardColor : 'green'
  const fabPresetId = isFabPresetId(parsed.data.fabPreset) ? parsed.data.fabPreset : 'prototype-hobby-2layer'

  const abort = new AbortController()
  const onClientAbort = () => abort.abort()
  request.signal.addEventListener('abort', onClientAbort, { once: true })

  let id = 0
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Omit<PipelineEvent, 'id'>) => {
        if (controller.desiredSize === null) return
        try {
          id += 1
          controller.enqueue(sse({ ...event, id } as PipelineEvent))
        } catch {
          /* the client went away */
        }
      }

      // Keep intermediaries (and Vercel) from buffering the stream.
      try {
        controller.enqueue(comment(`request ${requestId} started`))
      } catch {
        /* noop */
      }

      try {
        const design = await runPipeline(config, {
          brief: parsed.data.brief,
          revisionNote: parsed.data.revisionNote,
          boardColorId,
          fabPresetId,
          signal: abort.signal,
          requestId,
          cache,
          onEvent: send,
          onLog: (level, message) => {
            const line = JSON.stringify({ level, requestId, message: message.slice(0, 400) })
            if (level === 'warn') console.warn(line)
            else console.info(line)
          },
        })
        if (design.verified) {
          await saveVerifiedDesign(design).catch((error: unknown) => {
            console.warn(`[design:${requestId}] could not persist verified design:`, String(error))
          })
        }
      } catch (error) {
        const appError = toAppError(error)
        console.error(
          JSON.stringify({
            level: 'error',
            requestId,
            code: appError.code,
            internal: appError.internal ?? appError.message,
            durationMs: Date.now() - started,
          }),
        )
        const client = toClientError(appError, requestId)
        send({
          event: 'error',
          data: { ...client, requestId: client.requestId ?? requestId },
        })
      } finally {
        console.info(
          JSON.stringify({ level: 'info', requestId, durationMs: Date.now() - started }),
        )
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        request.signal.removeEventListener('abort', onClientAbort)
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': requestId,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
