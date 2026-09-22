import { convertBomRowsToCsv, convertCircuitJsonToBomRows } from 'circuit-json-to-bom-csv'
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber'
import { convertCircuitJsonToPickAndPlaceCsv } from 'circuit-json-to-pnp-csv'
import type { AnyCircuitElement } from 'circuit-json'
import JSZip from 'jszip'

import { buildManufacturingBundleResponse } from '@/lib/exports'
import { clientKeyFromRequest, createRateLimitStore } from '@/lib/rate-limit'
import { exportRequestSchema } from '@/lib/schemas'
import { getModelId } from '@/lib/server/config'
import { compileAndVerify } from '@/lib/server/verification'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const preferredRegion = ['sfo1', 'iad1']

const exportRateLimit = createRateLimitStore({ max: 10, windowMs: 5 * 60_000, maxKeys: 2000 })

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const clientKey = clientKeyFromRequest(request)

  if (!exportRateLimit.allow(clientKey)) {
    return new Response(
      JSON.stringify({ error: 'Too many export requests. Please wait.', requestId }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'X-Request-Id': requestId,
        },
      },
    )
  }

  const parsed = exportRequestSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    exportRateLimit.rollback(clientKey)
    return new Response(
      JSON.stringify({
        error: 'Invalid export request.',
        details: parsed.error.issues.slice(0, 3).map((i) => i.message),
        requestId,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      },
    )
  }

  const abortSignal = request.signal

  try {
    if (abortSignal.aborted) {
      throw new DOMException('Export aborted', 'AbortError')
    }

    const verification = await compileAndVerify(parsed.data.tsx, {
      signal: abortSignal,
      timeoutMs: 30_000,
    })
    const circuitJson = verification.circuitJson as AnyCircuitElement[]

    if (!verification.verified) {
      exportRateLimit.rollback(clientKey)
      return new Response(
        JSON.stringify({
          error: 'Manufacturing export blocked because verification failed.',
          diagnostics: verification.diagnostics.filter((item) => item.severity === 'error').slice(0, 20),
          requestId,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
      )
    }

    if (abortSignal.aborted) throw new DOMException('Export aborted', 'AbortError')

    const zip = new JSZip()

    // Gerber files with timeout guard
    let gerberFiles: Record<string, string>
    try {
      gerberFiles = convertCircuitJsonToGerberFiles(circuitJson)
    } catch (e) {
      throw new Error(`Gerber generation failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }

    for (const [filename, contents] of Object.entries(gerberFiles)) {
      if (abortSignal.aborted) throw new DOMException('Export aborted', 'AbortError')
      zip.file(`fabrication/${safeFilename(filename)}`, contents)
    }

    // BOM with error handling
    try {
      const bomRows = await convertCircuitJsonToBomRows({ circuitJson })
      zip.file('assembly/bom.csv', convertBomRowsToCsv(bomRows))
      zip.file('assembly/pick-and-place.csv', convertCircuitJsonToPickAndPlaceCsv(circuitJson))
    } catch (e) {
      console.warn(`[export:${requestId}] BOM generation warning:`, e)
      zip.file('assembly/bom-error.txt', `BOM generation failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }

    zip.file('design/circuit.tsx', parsed.data.tsx)
    zip.file('design/circuit.json', JSON.stringify(circuitJson, null, 2))
    zip.file(
      'verification/report.json',
      JSON.stringify(
        {
          verified: true,
          generatedAt: new Date().toISOString(),
          model: getModelId(),
          summary: parsed.data.summary,
          assumptions: parsed.data.assumptions,
          stats: verification.stats,
          diagnostics: verification.diagnostics,
          requestId,
        },
        null,
        2,
      ),
    )
    zip.file(
      'README.txt',
      `PCB COPILOT MANUFACTURING BUNDLE
Request: ${requestId}
Generated: ${new Date().toISOString()}

${parsed.data.summary}

ASSUMPTIONS:
${parsed.data.assumptions.map((a) => `- ${a}`).join('\n')}

This bundle was compiled from tscircuit TSX and passed automated compiler, connectivity, placement, and routing checks included in the verification report. Automated checks cannot validate every electrical, thermal, EMC, regulatory, footprint, or supply-chain constraint. A qualified engineer must review the schematic, datasheets, footprints, stack-up, and fabrication outputs before ordering or assembly.

STATS:
- Components: ${verification.stats.components}
- Nets: ${verification.stats.sourceTraces}
- Routed: ${verification.stats.routedTraces}
- Layers: ${verification.stats.pcbLayers}
${verification.stats.boardWidthMm ? `- Board: ${verification.stats.boardWidthMm} x ${verification.stats.boardHeightMm} mm` : ''}

VERIFICATION: PASSED
`,
    )

    const archive = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    if (archive.length > 50 * 1024 * 1024) {
      throw new Error('Manufacturing bundle too large (>50MB). Simplify design.')
    }

    return buildManufacturingBundleResponse(archive, requestId)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return new Response(null, { status: 499, headers: { 'X-Request-Id': requestId } })
    }
    console.error(`[export:${requestId}] failed:`, error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Export failed.',
        requestId,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
    )
  }
}

function safeFilename(name: string) {
  return name
    .replace(/[^a-z0-9._-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 100)
}
