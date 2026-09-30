import { z } from 'zod/v4'

import { toAppError, toClientError } from '@/lib/errors'
import { evaluateDesign } from '@/lib/checks'
import { assertSafeGeneratedCode, runInSandbox } from '@/lib/server/compile/sandbox'
import { getServerConfig } from '@/lib/server/env'
import { isFabPresetId } from '@/lib/server/checks/fab-presets'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const reviewRequestSchema = z.object({
  tsx: z.string().min(1).max(60_000),
  fabPreset: z.string().max(64).default('prototype-hobby-2layer'),
})

/**
 * Review an existing tscircuit .tsx without generating one.
 *
 * Runs through exactly the same sandbox and the same checks as the pipeline, so a design
 * imported from the playground is held to the same fabrication gate.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const parsed = reviewRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json(
      { code: 'INPUT_INVALID', message: 'Provide tscircuit source under 60000 characters.', retryable: false },
      { status: 400 },
    )
  }
  if (!isFabPresetId(parsed.data.fabPreset)) parsed.data.fabPreset = 'prototype-hobby-2layer'

  try {
    assertSafeGeneratedCode(parsed.data.tsx)
    const config = getServerConfig()
    const result = await runInSandbox(parsed.data.tsx, {
      timeoutMs: Math.min(config.compileTimeoutMs, 45_000),
      memoryMb: config.compileMemoryMb,
      maxElements: 60_000,
    })
    const report = evaluateDesign(result.circuitJson, result.checks, parsed.data.fabPreset)
    return Response.json({ report }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const appError = toAppError(error, 'COMPILE_FAILED')
    return Response.json(toClientError(appError, requestId), { status: appError.status })
  }
}
