import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIREWORKS_API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
const DEFAULT_MODEL_ID = 'accounts/fireworks/models/deepseek-v4-flash'

export type ServerConfig = {
  fireworksApiUrl: string
  modelId: string
  apiKey: string
}

let cachedConfig: ServerConfig | null = null
let cachedModelId: string | null = null

export function getModelId() {
  if (cachedModelId) return cachedModelId
  const model = readEnvSecret('FIREWORKS_MODEL_ID') || DEFAULT_MODEL_ID
  cachedModelId = model
  return model
}

export function getFireworksApiUrl() {
  return FIREWORKS_API_URL
}

/**
 * Reads API key with validation and caching.
 * On Vercel Fluid Compute, env vars are in process.env; .env.local fallback for local dev.
 * Caches after first successful read to minimize FS I/O.
 */
export function getServerConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig

  const apiKey = readEnvSecret('FIREWORKS_API_KEY')
  if (!apiKey) {
    throw new Error(
      'Fireworks is not configured. Add FIREWORKS_API_KEY to your environment or .env.local, then retry.',
    )
  }

  // Basic format validation to catch obvious misconfig early
  if (apiKey.length < 20) {
    throw new Error('FIREWORKS_API_KEY looks too short; check for truncation.')
  }

  const config: ServerConfig = {
    fireworksApiUrl: FIREWORKS_API_URL,
    modelId: getModelId(),
    apiKey,
  }
  cachedConfig = config
  return config
}

export function clearConfigCache() {
  cachedConfig = null
  cachedModelId = null
}

function isPlaceholder(value: string) {
  return (
    /YOUR_[A-Z0-9_]*KEY/i.test(value) ||
    /_HERE/i.test(value) ||
    /^(change|replace|insert)[_-]?me$/i.test(value) ||
    value === 'YOUR_FIREWORKS_API_KEY'
  )
}

function sanitizeSecret(value: string | undefined) {
  const trimmed = value?.trim().replace(/^[\"']|[\"']$/g, '') || ''
  if (!trimmed) return ''
  if (isPlaceholder(trimmed)) return ''
  return trimmed
}

function readEnvSecret(name: string) {
  const fromProcess = process.env[name]
  if (fromProcess) {
    const sanitized = sanitizeSecret(fromProcess)
    if (sanitized) return sanitized
  }

  // Fallback for local dev where .env.local may not be loaded (e.g., outside Next runtime)
  try {
    const contents = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    const lines = contents.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const equalsIndex = trimmed.indexOf('=')
      if (equalsIndex === -1) continue
      const key = trimmed.slice(0, equalsIndex).trim()
      if (key !== name) continue
      const value = sanitizeSecret(trimmed.slice(equalsIndex + 1))
      if (value) return value
    }
  } catch {
    // No .env.local present; fall through
  }

  return ''
}
