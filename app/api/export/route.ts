import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from 'circuit-json-to-bom-csv'
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber'
import { convertCircuitJsonToPickAndPlaceCsv } from 'circuit-json-to-pnp-csv'
import JSZip from 'jszip'
import { z } from 'zod'

import { compileAndVerify, getConfiguredModel } from '@/lib/server/pcb-agent'

export const runtime = 'nodejs'
export const maxDuration = 120

const exportSchema = z.object({
  tsx: z.string().min(1).max(80_000),
  summary: z.string().max(2_000).default('Generated PCB design'),
  assumptions: z.array(z.string().max(1_000)).max(30).default([]),
})

function safeFilename(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').toLowerCase()
}

export async function POST(request: Request) {
  const parsed = exportSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid export request.' }, { status: 400 })
  }

  try {
    const verification = await compileAndVerify(parsed.data.tsx)
    const blocking = verification.diagnostics.filter(
      (item) => item.severity === 'error',
    )
    if (!verification.verified) {
      return Response.json(
        {
          error: 'Manufacturing export blocked because verification failed.',
          diagnostics: blocking,
        },
        { status: 422 },
      )
    }

    const zip = new JSZip()
    const gerberFiles = convertCircuitJsonToGerberFiles(
      verification.circuitJson as never,
    )
    for (const [filename, contents] of Object.entries(gerberFiles)) {
      zip.file(`fabrication/${safeFilename(filename)}`, contents)
    }

    const bomRows = await convertCircuitJsonToBomRows({
      circuitJson: verification.circuitJson as never,
    })
    zip.file('assembly/bom.csv', convertBomRowsToCsv(bomRows))
    zip.file(
      'assembly/pick-and-place.csv',
      convertCircuitJsonToPickAndPlaceCsv(verification.circuitJson as never),
    )
    zip.file('design/circuit.tsx', parsed.data.tsx)
    zip.file(
      'design/circuit.json',
      JSON.stringify(verification.circuitJson, null, 2),
    )
    zip.file(
      'verification/report.json',
      JSON.stringify(
        {
          verified: true,
          generatedAt: new Date().toISOString(),
          model: getConfiguredModel(),
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

    return new Response(archive, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="pcb-copilot-manufacturing.zip"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Export failed.' },
      { status: 500 },
    )
  }
}
