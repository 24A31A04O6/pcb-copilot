import { convertBomRowsToCsv, convertCircuitJsonToBomRows } from 'circuit-json-to-bom-csv'
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber'
import { convertCircuitJsonToPickAndPlaceCsv } from 'circuit-json-to-pnp-csv'
import type { AnyCircuitElement } from 'circuit-json'
import JSZip from 'jszip'

import { buildManufacturingBundleResponse } from '@/lib/exports'
import { exportRequestSchema } from '@/lib/schemas'
import { getModelId } from '@/lib/server/config'
import { compileAndVerify } from '@/lib/server/verification'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  const parsed = exportRequestSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid export request.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const verification = await compileAndVerify(parsed.data.tsx)
    const circuitJson = verification.circuitJson as AnyCircuitElement[]

    if (!verification.verified) {
      return new Response(
        JSON.stringify({
          error: 'Manufacturing export blocked because verification failed.',
          diagnostics: verification.diagnostics.filter(
            (item) => item.severity === 'error',
          ),
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const zip = new JSZip()

    const gerberFiles = convertCircuitJsonToGerberFiles(circuitJson)
    for (const [filename, contents] of Object.entries(gerberFiles)) {
      zip.file(`fabrication/${safeFilename(filename)}`, contents)
    }

    const bomRows = await convertCircuitJsonToBomRows({ circuitJson })
    zip.file('assembly/bom.csv', convertBomRowsToCsv(bomRows))
    zip.file('assembly/pick-and-place.csv', convertCircuitJsonToPickAndPlaceCsv(circuitJson))
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
        },
        null,
        2,
      ),
    )
    zip.file(
      'README.txt',
      `PCB COPILOT MANUFACTURING BUNDLE\n\n${parsed.data.summary}\n\nThis bundle was compiled from tscircuit TSX and passed the automated compiler, connectivity, placement, and routing checks included in the verification report. Automated checks cannot validate every electrical, thermal, EMC, regulatory, footprint, or supply-chain constraint. A qualified engineer must review the schematic, datasheets, footprints, stack-up, and fabrication outputs before ordering or assembly.\n`,
    )

    const archive = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    return buildManufacturingBundleResponse(archive)
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Export failed.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

function safeFilename(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').toLowerCase()
}
