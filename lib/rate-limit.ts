type RateLimitStore = {
  allow(key: string): boolean
  rollback(key: string): void
  clear(key: string): void
  /** For diagnostics */
  size(): number
}

/**
 * Production-grade in-memory sliding-window rate limiter optimized for Vercel Fluid Compute.
 * - Bounded memory: LRU eviction + max keys
 * - Periodic pruning of expired entries
 * - Best-effort per-instance, not distributed (use Upstash Redis for true distributed limiting)
 * - Minimal allocations, O(1) amortized
 */
export function createRateLimitStore(options: {
  max: number
  windowMs: number
  maxKeys?: number
}): RateLimitStore {
  const maxKeys = options.maxKeys ?? 5000
  const timestamps = new Map<string, number[]>()
  let operationsSincePrune = 0
  const PRUNE_EVERY = 100

  function pruneIfNeeded() {
    operationsSincePrune++
    if (operationsSincePrune < PRUNE_EVERY) return
    operationsSincePrune = 0
    const now = Date.now()
    const cutoff = now - options.windowMs

    // Remove expired timestamps and empty keys
    for (const [key, times] of timestamps) {
      const filtered = times.filter((t) => t > cutoff)
      if (filtered.length === 0) {
        timestamps.delete(key)
      } else if (filtered.length !== times.length) {
        timestamps.set(key, filtered)
      }
    }

    // LRU eviction if over maxKeys: delete oldest entries
    if (timestamps.size > maxKeys) {
      const toDelete = timestamps.size - maxKeys
      let deleted = 0
      for (const key of timestamps.keys()) {
        if (deleted >= toDelete) break
        timestamps.delete(key)
        deleted++
      }
    }
  }

  return {
    allow(key: string) {
      const now = Date.now()
      const cutoff = now - options.windowMs
      const existing = timestamps.get(key)
      const recent = existing ? existing.filter((time) => time > cutoff) : []

      if (recent.length >= options.max) {
        timestamps.set(key, recent)
        pruneIfNeeded()
        return false
      }

      recent.push(now)
      timestamps.set(key, recent)
      pruneIfNeeded()
      return true
    },
    rollback(key: string) {
      const recent = timestamps.get(key)
      if (recent?.length) {
        recent.pop()
        if (recent.length === 0) timestamps.delete(key)
        else timestamps.set(key, recent)
      }
    },
    clear(key: string) {
      timestamps.delete(key)
    },
    size() {
      return timestamps.size
    },
  }
}

export function clientKeyFromRequest(request: Request): string {
  // Vercel provides x-forwarded-for and x-real-ip; prefer first valid public IP
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first && first.length > 0 && first !== '::1' && first !== '127.0.0.1') {
      return first
    }
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const cfIp = request.headers.get('cf-connecting-ip')?.trim()
  if (cfIp) return cfIp
  // Fallback to a hash of user-agent + language to somewhat isolate local dev
  const ua = request.headers.get('user-agent') || 'unknown'
  const lang = request.headers.get('accept-language') || 'en'
  // Simple hash for privacy, not crypto
  let hash = 0
  const combined = `${ua}:${lang}`
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31 + combined.charCodeAt(i)) >>> 0
  }
  return `local-${hash.toString(36)}`
}
