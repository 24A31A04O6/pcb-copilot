import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod/v4'

/**
 * Environment schema. Validated once per process, at first use, and it fails fast with a
 * message that names the exact variable. Nothing here is ever exposed to the browser.
 */

export const DEFAULT_MODEL = 'accounts/fireworks/models/glm-5p3-flash'
export const DEFAULT_FALLBACK_MODEL = 'accounts/fireworks/models/deepseek-v4p1-flash'

const modelId = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .refine(
    (v) => v.includes('/') && !v.endsWith('-latest'),
    'Model id must be a fully pinned Fireworks model path (e.g. accounts/fireworks/models/glm-5p3-flash). Moving aliases such as *-latest are not allowed.',
  )

const secret = z
  .string()
  .trim()
  .min(20, 'looks truncated')
  .refine((v) => !/^YOUR_|_HERE$|^change[-_]?me$/i.test(v), 'is still the placeholder value from .env.example')

const boolish = z
  .string()
  .optional()
  .transform((v) => v === '1' || v?.toLowerCase() === 'true')

const intish = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max))
    .catch(fallback)

const envSchema = z.object({
  FIREWORKS_API_KEY: secret,
  FIREWORKS_MODEL: modelId.default(DEFAULT_MODEL),
  FIREWORKS_FALLBACK_MODEL: modelId.optional(),
  FIREWORKS_BASE_URL: z
    .string()
    .trim()
    .url()
    .default('https://api.fireworks.ai/inference/v1'),
  FIREWORKS_TIMEOUT_MS: intish(5_000, 180_000, 60_000),
  FIREWORKS_CODEGEN_MAX_TOKENS: intish(1_000, 32_000, 8_000),
  ALLOW_FALLBACK_MODEL: boolish,
  UPSTASH_REDIS_REST_URL: z.string().trim().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().trim().min(10).optional(),
  TURNSTILE_SECRET_KEY: z.string().trim().min(10).optional(),
  TURNSTILE_SITE_KEY: z.string().trim().optional(),
  SENTRY_DSN: z.string().trim().url().optional(),
  WEB_SEARCH_ENABLED: boolish,
  WEB_SEARCH_API_KEY: z.string().trim().min(10).optional(),
  /** Part search backend. /q=...  WEB_SEARCH_API_KEY: z.string().trim().min(10).optional(),limit=n returns { results: PartRecord[] }. */
  PART_SEARCH_URL: z.string().trim().url().optional(),
  COMPILE_TIMEOUT_MS: intish(5_000, 120_000, 30_000),
  COMPILE_MEMORY_MB: intish(128, 2_048, 768),
})

export type Env = z.output<typeof envSchema>

let cached: Env | null = null

/**
 * Read `.env.local` when Next has not already injected it (scripts, workers, tests).
 * Never overwrites a variable that is already set in the real environment.
 */
function loadDotEnvLocal(): void {
  if (process.env.FIREWORKS_API_KEY) return
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (!key || process.env[key] !== undefined) continue
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (value) process.env[key] = value
    }
  } catch {
    // A missing or unreadable .env.local is not fatal: validation will report the problem.
  }
}

export class EnvError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(
      `Invalid server environment:\n${issues.map((i) => `  - ${i}`).join('\n')}\n` +
        'Copy .env.example to .env.local and fill in the values. See README.md → Configuration.',
    )
    this.name = 'EnvError'
    this.issues = issues
  }
}

export function getEnv(): Env {
  if (cached) return cached
  loadDotEnvLocal()

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)'
      return `${key}: ${issue.message}`
    })
    throw new EnvError(issues)
  }
  cached = parsed.data
  return cached
}

/** Test seam: force a specific env (or clear the cache with `null`). */
export function __setEnvForTests(env: Partial<Record<string, string>> | null): void {
  cached = null
  if (env === null) return
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

export type ServerConfig = {
  apiKey: string
  baseUrl: string
  model: string
  fallbackModel: string | null
  timeoutMs: number
  codegenMaxTokens: number
  compileTimeoutMs: number
  compileMemoryMb: number
  webSearchEnabled: boolean
  webSearchApiKey: string | null
  partSearch: { url: string | null; apiKey: string | null; timeoutMs: number; enabled: boolean }
  rateLimit: { url: string | null; token: string | null }
  turnstile: { secret: string | null; siteKey: string | null }
  sentryDsn: string | null
}

export function getServerConfig(): ServerConfig {
  const env = getEnv()
  const fallback =
    env.ALLOW_FALLBACK_MODEL && env.FIREWORKS_FALLBACK_MODEL ? env.FIREWORKS_FALLBACK_MODEL : null

  return {
    apiKey: env.FIREWORKS_API_KEY,
    baseUrl: env.FIREWORKS_BASE_URL.replace(/\/+$/, ''),
    model: env.FIREWORKS_MODEL,
    fallbackModel: fallback,
    timeoutMs: env.FIREWORKS_TIMEOUT_MS,
    codegenMaxTokens: env.FIREWORKS_CODEGEN_MAX_TOKENS,
    compileTimeoutMs: env.COMPILE_TIMEOUT_MS,
    compileMemoryMb: env.COMPILE_MEMORY_MB,
    webSearchEnabled: env.WEB_SEARCH_ENABLED && Boolean(env.WEB_SEARCH_API_KEY),
    webSearchApiKey: env.WEB_SEARCH_API_KEY ?? null,
    partSearch: {
      url: env.PART_SEARCH_URL ?? null,
      apiKey: env.WEB_SEARCH_API_KEY ?? null,
      timeoutMs: env.FIREWORKS_TIMEOUT_MS,
      // Both a URL and an explicit opt-in are required. A half-configured deployment must
      // degrade to "no part search", never to a tool that fails on the first call.
      enabled: env.WEB_SEARCH_ENABLED && Boolean(env.PART_SEARCH_URL),
    },
    rateLimit: { url: env.UPSTASH_REDIS_REST_URL ?? null, token: env.UPSTASH_REDIS_REST_TOKEN ?? null },
    turnstile: { secret: env.TURNSTILE_SECRET_KEY ?? null, siteKey: env.TURNSTILE_SITE_KEY ?? null },
    sentryDsn: env.SENTRY_DSN ?? null,
  }
}

/** Short label for the model badge in the UI. Never includes the key. */
export function shortModelName(model: string): string {
  const tail = model.split('/').pop() ?? model
  return tail.replace(/-flash$/i, '').replace(/-\d+p\d+/i, '')
}

export function __resetEnvCache(): void {
  cached = null
}
