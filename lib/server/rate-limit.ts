/**
 * Rate limiting.
 *
 * Upstash Redis is used when configured (a real, distributed, per-IP limit that survives
 * across serverless instances). Otherwise a bounded in-process sliding window is used,
 * which still protects a single warm instance. The in-memory path is explicitly *not*
 * claimed to be a distributed limit — see docs/DECISIONS.md §6.
 */

const DEFAULTS = {
  max: 8,
  windowSeconds: 600,
  dailyMax: 60,
  daySeconds: 86_400,
}

type Bucket = { timestamps: number[] }

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number; limit: number; remaining: number }

const buckets = new Map<string, Bucket>()
let operationsSincePrune = 0

function prune(now: number) {
  operationsSincePrune += 1
  if (operationsSincePrune < 64) return
  operationsSincePrune = 0
  const cutoff = now - DEFAULTS.daySeconds * 1000
  for (const [key, bucket] of buckets) {
    const kept = bucket.timestamps.filter((t) => t > cutoff)
    if (kept.length === 0) buckets.delete(key)
    else bucket.timestamps = kept
  }
  while (buckets.size > 5_000) {
    const oldest = buckets.keys().next()
    if (oldest.done) break
    buckets.delete(oldest.value)
  }
}

function localLimit(key: string): RateLimitResult {
  const now = Date.now()
  prune(now)
  const bucket = buckets.get(key) ?? { timestamps: [] }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < DEFAULTS.daySeconds * 1000)
  buckets.set(key, bucket)

  const inWindow = bucket.timestamps.filter((t) => now - t < DEFAULTS.windowSeconds * 1000)
  const inDay = bucket.timestamps

  if (inWindow.length >= DEFAULTS.max) {
    const retryAfter = Math.ceil((inWindow[0] + DEFAULTS.windowSeconds * 1000 - now) / 1000)
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter), limit: DEFAULTS.max, remaining: 0 }
  }
  if (inDay.length >= DEFAULTS.dailyMax) {
    const retryAfter = Math.ceil((inDay[0] + DEFAULTS.daySeconds * 1000 - now) / 1000)
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter), limit: DEFAULTS.dailyMax, remaining: 0 }
  }

  bucket.timestamps.push(now)
  return {
    allowed: true,
    retryAfterSeconds: 0,
    limit: DEFAULTS.max,
    remaining: DEFAULTS.max - inWindow.length - 1,
  }
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return (
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'anonymous'
  )
}

async function redisLimit(key: string): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '')
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const call = async (command: string) => {
      const response = await fetch(`${url}/${command.split(' ').map(encodeURIComponent).join('/')}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!response.ok) return null
      const payload = (await response.json()) as { result: number }
      return payload.result
    }

    // Two fixed windows: a short burst limit and a daily cost guard.
    const windowKey = `pcb:rl:w:${key}`
    const dayKey = `pcb:rl:d:${key}`
    const windowCount = await call(`INCR ${windowKey}`)
    if (windowCount === 1) await call(`EXPIRE ${windowKey} ${DEFAULTS.windowSeconds}`)
    const dayCount = await call(`INCR ${dayKey}`)
    if (dayCount === 1) await call(`EXPIRE ${dayKey} ${DEFAULTS.daySeconds}`)
    if (windowCount === null || dayCount === null) return null

    if (windowCount > DEFAULTS.max) {
      return {
        allowed: false,
        retryAfterSeconds: DEFAULTS.windowSeconds,
        limit: DEFAULTS.max,
        remaining: 0,
      }
    }
    if (dayCount > DEFAULTS.dailyMax) {
      return {
        allowed: false,
        retryAfterSeconds: DEFAULTS.daySeconds,
        limit: DEFAULTS.dailyMax,
        remaining: 0,
      }
    }
    return {
      allowed: true,
      retryAfterSeconds: 0,
      limit: DEFAULTS.max,
      remaining: Math.max(0, DEFAULTS.max - windowCount),
    }
  } catch {
    return null
  }
}

export async function rateLimitDesign(request: Request): Promise<RateLimitResult> {
  const key = clientIp(request)
  const distributed = await redisLimit(key)
  if (distributed) return distributed
  return localLimit(key)
}

export async function rateLimitExport(request: Request): Promise<RateLimitResult> {
  const key = `${clientIp(request)}:export`
  const distributed = await redisLimit(key)
  if (distributed) return distributed
  return localLimit(key)
}

/** Test seam. */
export function __resetRateLimits(): void {
  buckets.clear()
  operationsSincePrune = 0
}
