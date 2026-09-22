type RateLimitStore = {
  /** Record a request for a key and return whether it is under the limit. */
  allow(key: string): boolean
  /** Reject a request by decrementing the count recorded for a key. */
  rollback(key: string): void
  /** Remove the entry for a key entirely, e.g. after cancelling a request. */
  clear(key: string): void
}

/**
 * A minimal in-memory sliding-window rate limiter.
 *
 * This is intended for a single serverless/edge instance and is best-effort,
 * not a distributed guarantee.
 */
export function createRateLimitStore(options: {
  /** Max number of allowed requests within the window. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
}): RateLimitStore {
  const timestamps = new Map<string, number[]>()

  return {
    allow(key) {
      const now = Date.now()
      const cutoff = now - options.windowMs
      const recent = (timestamps.get(key) ?? []).filter((time) => time > cutoff)
      if (recent.length >= options.max) {
        timestamps.set(key, recent)
        return false
      }
      recent.push(now)
      timestamps.set(key, recent)
      return true
    },
    rollback(key) {
      const recent = timestamps.get(key)
      if (recent?.length) recent.pop()
    },
    clear(key) {
      timestamps.delete(key)
    },
  }
}

export function clientKeyFromRequest(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}
