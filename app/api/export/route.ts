import { toClientError, toAppError } from '@/lib/errors'
import { rateLimitExport } from '@/lib/server/rate-limit'
import { exportRequestSchema } from '@/lib/schemas'
import { buildFabricationBundle, buildIndividualFiles, bundleFilename } from '@/lib/server/exports'
import { getVerifiedDesign } from '@/lib/server/store'
import type { DesignResult } from '@/lib/design'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Exports are keyed by design hash. The server re-reads its own verified record and
 * re-runs nothing that the client controls, so a caller cannot get Gerbers for a design
 * that never passed the checks.
 */

function storedToDesign(entry: NonNullable<Awaited<ReturnType<typeof getVerifiedDesign>>>): DesignResult {
  return {
    slug: entry.slug,
    title: entry.title,
    summary: entry.summary,
    tsx: entry.tsx,
    circuitJson: entry.circuitJson,
    checks: entry.checks,
    stats: entry.stats,
    verified: true,
    blockingCount: 0,
    warningCount: entry.checks.filter((check) => check.severity === 'warning').length,
    iterations: 1,
    model: entry.model,
    fallbackUsed: false,
    partSearchUsed: false,
    fab: entry.fab,
    designHash: entry.designHash,
    generatedAt: entry.generatedAt,
    durationMs: 0,
    repairCount: 0,
    tokenUsage: { input: 0, output: 0 },
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  const limit = await rateLimitExport(request)
  if (!limit.allowed) {
    return Response.json(
      {
        code: 'RATE_LIMITED',
        message: 'Too many export downloads. Try again shortly.',
        retryable: true,
        requestId,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const parsed = exportRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json(
      { code: 'INPUT_INVALID', message: 'Invalid export request.', retryable: false, requestId },
      { status: 400 },
    )
  }

  const entry = await getVerifiedDesign(parsed.data.designHash)
  if (!entry || !entry.verified) {
    return Response.json(
      {
        code: 'CHECKS_FAILED',
        message:
          'Manufacturing exports are locked. This design is not in the server-side verified set — re-run it, or fix the blocking checks first.',
        retryable: true,
        requestId,
      },
      { status: 423 },
    )
  }

  const design = storedToDesign(entry)

  try {
    if (parsed.data.kind === 'fab-zip') {
      const bundle = await buildFabricationBundle(design)
      const filename = `${bundleFilename(design.slug, design.designHash)}-fab.zip`
      return new Response(new Uint8Array(bundle.data), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(bundle.data.byteLength),
          'Cache-Control': 'no-store',
          'X-Request-Id': requestId,
        },
      })
    }

    const files = await buildIndividualFiles(design)
    // One path per kind, declared once. The Gerber set is the only multi-file answer, and
    // it is concatenated below with a header naming each layer.
    const SINGLE_FILE_PATHS = {
      'circuit-json': 'design/circuit.json',
      'circuit-tsx': 'design/circuit.tsx',
      manifest: 'manifest.json',
      bom: 'assembly/bom.csv',
      pnp: 'assembly/pick-and-place.csv',
    } as const

    // `fab-zip` already returned above; `gerbers` is the only multi-file kind left.
    const kind: string = parsed.data.kind
    const wanted =
      kind === 'gerbers'
        ? files.filter((file) => file.path.startsWith('fabrication/'))
        : files.filter((file) => file.path === SINGLE_FILE_PATHS[kind as keyof typeof SINGLE_FILE_PATHS])

    if (!wanted.length) {
      return Response.json(
        { code: 'INPUT_INVALID', message: 'Nothing to export for that kind.', retryable: false, requestId },
        { status: 404 },
      )
    }

    if (parsed.data.kind === 'gerbers') {
      // Several layers in one download: name each file in a header, then the files.
      const combined = wanted
        .map((file) => `; --- ${file.path} ---\n${typeof file.data === 'string' ? file.data : '[binary]'}`)
        .join('\n')
      return new Response(combined, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${bundleFilename(design.slug, design.designHash)}-gerbers.txt"`,
          'Cache-Control': 'no-store',
          'X-Request-Id': requestId,
        },
      })
    }

    const filename = wanted[0].path.split('/').pop() ?? 'export'
    return new Response(wanted[0].data as BodyInit, {
      headers: {
        'Content-Type': wanted[0].mime,
        'Content-Disposition': `attachment; filename="${bundleFilename(design.slug, design.designHash)}-${filename}"`,
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    const appError = toAppError(error)
    console.error(`[export:${requestId}] ${appError.internal ?? appError.message}`)
    return Response.json(toClientError(appError, requestId), { status: 500 })
  }
}
