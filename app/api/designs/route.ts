import { listDesignHistory } from '@/lib/server/store'
import { historyQuerySchema } from '@/lib/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Server-side design history. Used when Upstash Redis is configured; otherwise the UI
 *  falls back to its own localStorage history, which is stated in the response. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = historyQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return Response.json({ error: 'Invalid limit' }, { status: 400 })
  }
  const entries = await listDesignHistory(parsed.data.limit)
  return Response.json(
    { entries, source: process.env.UPSTASH_REDIS_REST_URL ? 'kv' : 'in-memory' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
