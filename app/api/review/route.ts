import { reviewRequestSchema } from '@/lib/schemas'
import { compileAndVerify } from '@/lib/server/verification'
import { categorizeDiagnostics, getManufacturingReadinessScore } from '@/lib/design'
import { clientKeyFromRequest, createRateLimitStore } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const preferredRegion = ['sfo1', 'iad1']

const reviewRateLimit = createRateLimitStore({ max: 20, windowMs: 60_000, maxKeys: 2000 })

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const clientKey = clientKeyFromRequest(request)

  if (!reviewRateLimit.allow(clientKey)) {
    return new Response(
      JSON.stringify({ error: 'Too many review requests.', requestId }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
    )
  }

  const parsed = reviewRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    reviewRateLimit.rollback(clientKey)
    return new Response(
      JSON.stringify({ error: 'Invalid review request.', requestId }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
    )
  }

  try {
    const verification = await compileAndVerify(parsed.data.tsx, {
      signal: request.signal,
      timeoutMs: 20_000,
    })

    const categorized = categorizeDiagnostics(verification.diagnostics)
    const score = verification.verified
      ? getManufacturingReadinessScore({
          ...verification,
          tsx: parsed.data.tsx,
          summary: '',
          assumptions: [],
          iterations: 1,
          model: 'review',
          circuitJson: verification.circuitJson,
        } as any)
      : 0

    // Enhanced review with suggestions
    const enhancedDiagnostics = verification.diagnostics.map((diag) => {
      let suggestion: string | undefined
      const msg = diag.message.toLowerCase()
      const type = diag.type.toLowerCase()

      if (type.includes('trace') || msg.includes('trace')) {
        suggestion = 'Check trace width, clearance, and layer assignment. Ensure nets are fully connected.'
      } else if (type.includes('footprint') || msg.includes('footprint')) {
        suggestion = 'Verify footprint exists in library and matches datasheet. Check pin numbering.'
      } else if (type.includes('overlap') || msg.includes('overlap')) {
        suggestion = 'Components overlapping. Adjust pcbX/pcbY positions to provide clearance.'
      } else if (type.includes('unconnected') || msg.includes('unconnected')) {
        suggestion = 'Net not fully connected. Add missing trace or check selector syntax like .U1 > .VCC'
      } else if (msg.includes('power') || msg.includes('ground')) {
        suggestion = 'Ensure power nets reach all components. Add decoupling capacitors close to ICs.'
      }

      return { ...diag, suggestion }
    })

    const checklist = [
      {
        id: 'compile',
        label: 'Compiles',
        passed: true,
        severity: 'critical' as const,
        message: 'TSX compiles to Circuit JSON',
      },
      {
        id: 'errors',
        label: 'No blocking errors',
        passed: categorized.errors.length === 0,
        severity: 'critical' as const,
        message:
          categorized.errors.length === 0
            ? 'No blocking errors'
            : `${categorized.errors.length} blocking error(s) found`,
        details: categorized.errors.slice(0, 5),
      },
      {
        id: 'warnings',
        label: 'Warnings reviewed',
        passed: categorized.warnings.length <= 5,
        severity: 'medium' as const,
        message:
          categorized.warnings.length === 0
            ? 'No warnings'
            : `${categorized.warnings.length} warning(s) - review recommended`,
        details: categorized.warnings.slice(0, 5),
      },
      {
        id: 'components',
        label: 'Components placed',
        passed: verification.stats.components > 0,
        severity: 'critical' as const,
        message: `${verification.stats.components} components`,
      },
      {
        id: 'routing',
        label: 'Routing complete',
        passed: verification.stats.routedTraces >= verification.stats.sourceTraces * 0.8,
        severity: 'high' as const,
        message: `${verification.stats.routedTraces}/${verification.stats.sourceTraces} traces routed`,
      },
      {
        id: 'board_size',
        label: 'Board dimensions',
        passed: !!verification.stats.boardWidthMm,
        severity: 'low' as const,
        message: verification.stats.boardWidthMm
          ? `${verification.stats.boardWidthMm} × ${verification.stats.boardHeightMm} mm`
          : 'No board size detected',
      },
    ]

    return new Response(
      JSON.stringify({
        verified: verification.verified,
        score,
        stats: verification.stats,
        diagnostics: enhancedDiagnostics,
        categorized: {
          errors: categorized.errors,
          warnings: categorized.warnings,
          byType: categorized.byType,
          total: categorized.total,
        },
        checklist,
        manufacturingReady: verification.verified && score >= 80,
        requestId,
        reviewedAt: new Date().toISOString(),
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'Cache-Control': 'no-store',
        },
      },
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return new Response(null, { status: 499, headers: { 'X-Request-Id': requestId } })
    }
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Review failed',
        requestId,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
    )
  }
}
