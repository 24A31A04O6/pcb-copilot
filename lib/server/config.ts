import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIREWORKS_API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
const DEFAULT_MODEL_ID = 'accounts/fireworks/models/deepseek-v4-flash'

export type ServerConfig = {
  fireworksApiUrl: string
  modelId: string
  apiKey: string
}

export function getModelId() {
  return readEnvSecret('FIREWORKS_MODEL_ID') || DEFAULT_MODEL_ID
}

export function getFireworksApiUrl() {
  return FIREWORKS_API_URL
}

/**
 * The API key and optional model id are read from `process.env` first
 * (deployed env / Vercel "Vars", and Next.js also loads `.env.local` into
 * `process.env` at runtime), then fall back to reading the corresponding
 * lines in `.env.local` directly so the app degrades gracefully outside the
 * Next runtime.
 */
export function getServerConfig(): ServerConfig {
  const apiKey = readEnvSecret('FIREWORKS_API_KEY')
  if (!apiKey) {
    throw new Error(
      'Fireworks is not configured. Add FIREWORKS_API_KEY to your environment or .env.local, then retry.',
    )
  }
  return {
    fireworksApiUrl: FIREWORKS_API_URL,
    modelId: getModelId(),
    apiKey,
  }
}

function isPlaceholder(value: string) {
  return (
    /YOUR_[A-Z0-9_]*KEY/i.test(value) ||
    /_HERE/i.test(value) ||
    /^(change|replace|insert)[_-]?me$/i.test(value)
  )
}

function sanitizeSecret(value: string | undefined) {
  const trimmed = value?.trim().replace(/^["']|["']$/g, '') || ''
  return isPlaceholder(trimmed) ? '' : trimmed
}

function readEnvSecret(name: string) {
  const fromProcess = process.env[name]
  if (fromProcess) {
    const sanitized = sanitizeSecret(fromProcess)
    if (sanitized) return sanitized
  }

  // Fallback for contexts where `.env.local` is not loaded into process.env.
  try {
    const contents = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    const lines = contents.split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const equalsIndex = line.indexOf('=')
      if (equalsIndex === -1) continue
      const key = line.slice(0, equalsIndex).trim()
      if (key !== name) continue
      const value = sanitizeSecret(line.slice(equalsIndex + 1))
      if (value) return value
    }
  } catch {
    // No .env.local present; fall through to empty.
  }

  return ''
}
