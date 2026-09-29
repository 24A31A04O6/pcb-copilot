import '@/lib/server/only'

import type { DesignResult } from '@/lib/design'

/**
 * Verified-design store.
 *
 * The fabrication gate is bound to a **server-side** record keyed by design hash. The
 * client can only ask for an export by hash; it can never hand the server arbitrary TSX
 * to be compiled and exported. That is the difference between "the browser asked nicely"
 * and "the board passed its checks".
 *
 * Backed by Upstash Redis when configured (so it survives across serverless instances)
 * and by a bounded in-process LRU otherwise.
 */

export type StoredDesign = {
  designHash: string
  slug: string
  title: string
  summary: string
  tsx: string
  circuitJson: unknown[]
  checks: DesignResult['checks']
  stats: DesignResult['stats']
  verified: true
  fab: DesignResult['fab']
  model: string
  generatedAt: string
  designId: string
}

const MAX_ENTRIES = 40
const local = new Map<string, StoredDesign>()

function redis(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null
}

async function redisCommand<T>(...parts: string[]): Promise<T | null> {
  const config = redis()
  if (!config) return null
  try {
    const response = await fetch(`${config.url}/${parts.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { result: T }
    return payload.result
  } catch {
    return null
  }
}

function rememberLocal(entry: StoredDesign): void {
  local.set(entry.designHash, entry)
  while (local.size > MAX_ENTRIES) {
    const oldest = local.keys().next()
    if (oldest.done) break
    local.delete(oldest.value)
  }
}

export async function saveVerifiedDesign(design: DesignResult): Promise<StoredDesign> {
  if (!design.verified) {
    throw new Error('Refusing to store an unverified design: the fabrication gate must stay closed.')
  }
  const entry: StoredDesign = {
    designHash: design.designHash,
    slug: design.slug,
    title: design.title,
    summary: design.summary,
    tsx: design.tsx,
    circuitJson: design.circuitJson,
    checks: design.checks,
    stats: design.stats,
    verified: true,
    fab: design.fab,
    model: design.model,
    generatedAt: design.generatedAt,
    designId: design.designHash,
  }

  rememberLocal(entry)

  const key = `pcb:design:${entry.designHash}`
  const ttl = 60 * 60 * 24 * 30 // 30 days
  await redisCommand('SET', key, JSON.stringify(entry), 'EX', String(ttl))
  await redisCommand('ZADD', 'pcb:designs', Date.now().toString(), entry.designHash)
  await redisCommand('ZREMRANGEBYRANK', 'pcb:designs', '0', String(-(MAX_ENTRIES + 1)))
  await redisCommand('EXPIRE', 'pcb:designs', String(ttl))

  return entry
}

export async function getVerifiedDesign(designHash: string): Promise<StoredDesign | null> {
  if (!/^[0-9a-f]{6,64}$/.test(designHash)) return null
  const fromRedis = await redisCommand<string | null>('GET', `pcb:design:${designHash}`)
  if (fromRedis) {
    try {
      const parsed = JSON.parse(fromRedis) as StoredDesign
      rememberLocal(parsed)
      return parsed
    } catch {
      /* fall through to the local copy */
    }
  }
  return local.get(designHash) ?? null
}

export type HistoryEntry = {
  designHash: string
  slug: string
  title: string
  summary: string
  verified: boolean
  model: string
  generatedAt: string
  solderMask: string
  components: number
  boardWidthMm: number | null
  boardHeightMm: number | null
}

export async function listDesignHistory(limit = 20): Promise<HistoryEntry[]> {
  const localEntries: HistoryEntry[] = [...local.values()]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .map((entry) => ({
      designHash: entry.designHash,
      slug: entry.slug,
      title: entry.title,
      summary: entry.summary,
      verified: entry.verified,
      model: entry.model,
      generatedAt: entry.generatedAt,
      solderMask: entry.fab.solderMask,
      components: entry.stats.components,
      boardWidthMm: entry.stats.boardWidthMm,
      boardHeightMm: entry.stats.boardHeightMm,
    }))

  const hashes = await redisCommand<string[] | null>('ZREVRANGE', 'pcb:designs', '0', String(limit - 1))
  if (!hashes?.length) return localEntries.slice(0, limit)

  const merged = new Map<string, HistoryEntry>()
  for (const hash of hashes) {
    const entry = await getVerifiedDesign(hash)
    if (entry) {
      merged.set(entry.designHash, {
        designHash: entry.designHash,
        slug: entry.slug,
        title: entry.title,
        summary: entry.summary,
        verified: entry.verified,
        model: entry.model,
        generatedAt: entry.generatedAt,
        solderMask: entry.fab.solderMask,
        components: entry.stats.components,
        boardWidthMm: entry.stats.boardWidthMm,
        boardHeightMm: entry.stats.boardHeightMm,
      })
    }
  }
  for (const entry of localEntries) if (!merged.has(entry.designHash)) merged.set(entry.designHash, entry)
  return [...merged.values()].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, limit)
}

/** In-process design cache used by `runPipeline` to skip identical runs. */
class BoundedCache extends Map<string, DesignResult> {
  constructor(private readonly maxEntries: number) {
    super()
  }

  override set(key: string, value: DesignResult) {
    super.set(key, value)
    while (this.size > this.maxEntries) {
      const oldest = this.keys().next()
      if (oldest.done) break
      super.delete(oldest.value)
    }
    return this
  }
}

export function createDesignCache(maxEntries = 50): Map<string, DesignResult> {
  return new BoundedCache(maxEntries)
}
