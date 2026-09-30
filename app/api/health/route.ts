import { EnvError, getEnv, getServerConfig, shortModelName } from '@/lib/server/env'
import { FAB_PRESETS } from '@/lib/server/checks/fab-presets'
import { TSCIRCUIT_VERSIONS } from '@/lib/server/versions'
import { ERROR_CODES } from '@/lib/errors'
import { isPartSearchEnabled } from '@/lib/server/parts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Liveness + readiness in one document. Reports *what is configured*, never the value of
 * a secret: a health endpoint that can leak an API key is an information-disclosure bug.
 */
export function GET() {
  let configured = false
  let model: string | null = null
  let fallbackModel: string | null = null
  let envError: string | null = null

  try {
    const config = getServerConfig()
    configured = true
    model = shortModelName(config.model)
    fallbackModel = config.fallbackModel ? shortModelName(config.fallbackModel) : null
  } catch (error) {
    // Name the variables that are wrong, never their values. `EnvError.issues` is a list
    // of `KEY: reason` strings and nothing else.
    envError = error instanceof EnvError ? error.issues.join('; ') : 'server configuration is unreadable'
  }

  let partSearchConfigured = false
  try {
    partSearchConfigured = isPartSearchEnabled(getServerConfig().partSearch)
  } catch {
    partSearchConfigured = false
  }

  let envKeys = 0
  try {
    getEnv()
    envKeys = 1
  } catch {
    envKeys = 0
  }

  const body = {
    status: configured ? ('ok' as const) : ('degraded' as const),
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    model,
    fallbackModel,
    environmentValid: envKeys === 1,
    ...(envError ? { envError } : {}),
    toolchain: {
      '@tscircuit/eval': TSCIRCUIT_VERSIONS.eval,
      '@tscircuit/checks': TSCIRCUIT_VERSIONS.checks,
      'circuit-json': TSCIRCUIT_VERSIONS.circuitJson,
      '@tscircuit/3d-viewer': TSCIRCUIT_VERSIONS.viewer3d,
      node: TSCIRCUIT_VERSIONS.node,
    },
    fabPresets: FAB_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      minTraceMm: preset.minTraceMm,
      minSpaceMm: preset.minSpaceMm,
      minHoleMm: preset.minHoleMm,
      checkedOn: preset.checkedOn,
    })),
    errorCodes: ERROR_CODES,
    features: [
      'sse-pipeline',
      'sandboxed-compile',
      'fabrication-gate',
      'fab-presets',
      'board-colours',
      'knowledge-rag',
      'golden-designs',
      'design-evals',
      ...(partSearchConfigured ? ['part-search'] : []),
    ],
  }

  return Response.json(body, {
    status: configured ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
