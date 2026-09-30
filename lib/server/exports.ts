import '@/lib/server/only'

import JSZip from 'jszip'

import { BOARD_COLORS } from '@/lib/board-colors'
import type { DesignResult } from '@/lib/design'

import { getFabPreset } from './checks/fab-presets'
import { loadConverters } from './converters'
import { TSCIRCUIT_VERSIONS } from './versions'

export type ExportBundle = {
  filename: string
  data: Uint8Array
  manifest: ExportManifest
}

export type ExportManifest = {
  designHash: string
  slug: string
  title: string
  summary: string
  generatedAt: string
  model: string
  toolVersions: Record<string, string>
  board: {
    widthMm: number | null
    heightMm: number | null
    layers: number
    thicknessMm: number | null
    solderMaskColor: string
    solderMaskHex: string
    silkscreenColor: string
    silkscreenHex: string
  }
  fab: { presetId: string; label: string; source: string; checkedOn: string }
  checks: {
    passed: boolean
    blocking: number
    warnings: number
    blockingList: Array<{ code: string; message: string }>
    warningList: Array<{ code: string; message: string }>
  }
  stats: DesignResult['stats']
  contents: string[]
  disclaimer: string
}

const DISCLAIMER =
  'Automated checks cover compilation, connectivity, placement, routing and the selected fab capability table. ' +
  'They do not validate every electrical, thermal, EMC, regulatory, footprint or supply-chain constraint. ' +
  'A qualified engineer must review the schematic, datasheets, footprints, stack-up and fabrication outputs ' +
  'before ordering or assembly.'

function safeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 120)
}

/** `<slug>-<shortHash>-<YYYYMMDD>` */
export function bundleFilename(slug: string, designHash: string, date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${safeFilename(slug)}-${designHash.slice(0, 8)}-${y}${m}${d}`
}

export function buildManifest(design: DesignResult): ExportManifest {
  const preset = getFabPreset(design.fab.presetId)
  const mask =
    BOARD_COLORS.find((color) => color.mask === design.fab.solderMask) ?? BOARD_COLORS[0]

  return {
    designHash: design.designHash,
    slug: design.slug,
    title: design.title,
    summary: design.summary,
    generatedAt: design.generatedAt,
    model: design.model,
    toolVersions: {
      '@tscircuit/eval': TSCIRCUIT_VERSIONS.eval,
      '@tscircuit/checks': TSCIRCUIT_VERSIONS.checks,
      'circuit-json': TSCIRCUIT_VERSIONS.circuitJson,
      'circuit-json-to-gerber': TSCIRCUIT_VERSIONS.gerber,
      'circuit-json-to-bom-csv': TSCIRCUIT_VERSIONS.bom,
      'circuit-json-to-pnp-csv': TSCIRCUIT_VERSIONS.pnp,
      node: TSCIRCUIT_VERSIONS.node,
    },
    board: {
      widthMm: design.stats.boardWidthMm,
      heightMm: design.stats.boardHeightMm,
      layers: design.stats.pcbLayers,
      thicknessMm: design.stats.boardThicknessMm,
      solderMaskColor: mask.mask,
      solderMaskHex: mask.hex,
      silkscreenColor: mask.silk,
      silkscreenHex: mask.silkHex,
    },
    fab: { presetId: preset.id, label: preset.label, source: preset.source, checkedOn: preset.checkedOn },
    checks: {
      passed: design.verified,
      blocking: design.blockingCount,
      warnings: design.warningCount,
      blockingList: design.checks
        .filter((check) => check.severity === 'error')
        .map((check) => ({ code: check.code, message: check.message })),
      warningList: design.checks
        .filter((check) => check.severity === 'warning')
        .map((check) => ({ code: check.code, message: check.message })),
    },
    stats: design.stats,
    contents: [],
    disclaimer: DISCLAIMER,
  }
}

export async function buildFabricationBundle(design: DesignResult): Promise<ExportBundle> {
  if (!design.verified) {
    throw new Error('buildFabricationBundle called for an unverified design; the gate must stay closed.')
  }

  const zip = new JSZip()
  const contents: string[] = []
  const add = (path: string, data: string | Uint8Array) => {
    zip.file(path, data)
    contents.push(path)
  }

  const circuitJson = design.circuitJson as never
  const { convertCircuitJsonToGerberFiles, convertCircuitJsonToBomRows, convertBomRowsToCsv, convertCircuitJsonToPickAndPlaceCsv } =
    await loadConverters()

  // --- fabrication: Gerbers + Excellon drill --------------------------------
  const gerbers = convertCircuitJsonToGerberFiles(circuitJson)
  for (const [name, body] of Object.entries(gerbers)) {
    add(`fabrication/${safeFilename(name)}`, body)
  }

  // --- assembly: BOM + pick-and-place ---------------------------------------
  try {
    const rows = await convertCircuitJsonToBomRows({ circuitJson })
    add('assembly/bom.csv', convertBomRowsToCsv(rows))
  } catch (error) {
    add(
      'assembly/bom-error.txt',
      `BOM generation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    add('assembly/pick-and-place.csv', convertCircuitJsonToPickAndPlaceCsv(circuitJson))
  } catch (error) {
    add(
      'assembly/pick-and-place-error.txt',
      `Pick-and-place generation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // --- design sources --------------------------------------------------------
  add('design/circuit.tsx', design.tsx)
  add('design/circuit.json', JSON.stringify(design.circuitJson, null, 2))

  // --- verification ----------------------------------------------------------
  add(
    'verification/checks.json',
    JSON.stringify(
      {
        verified: design.verified,
        blocking: design.blockingCount,
        warnings: design.warningCount,
        fab: design.fab,
        checks: design.checks,
      },
      null,
      2,
    ),
  )

  const manifest = buildManifest(design)
  add('manifest.json', JSON.stringify({ ...manifest, contents }, null, 2))

  const preset = getFabPreset(design.fab.presetId)
  add(
    'README.txt',
    [
      'PCB-COPILOT FABRICATION PACKAGE',
      '='.repeat(34),
      '',
      `Design:      ${design.title}`,
      `Hash:        ${design.designHash}`,
      `Generated:   ${design.generatedAt}`,
      `Model:       ${design.model}`,
      `Board:       ${design.stats.boardWidthMm ?? '?'} x ${design.stats.boardHeightMm ?? '?'} mm, ${design.stats.pcbLayers} layer(s), ${design.stats.boardThicknessMm ?? '?'} mm`,
      `Solder mask: ${manifest.board.solderMaskColor} (${manifest.board.solderMaskHex})`,
      `Silkscreen:  ${manifest.board.silkscreenColor}`,
      `Fab preset:  ${preset.label}`,
      `             ${preset.source} (read ${preset.checkedOn})`,
      '',
      `Components:  ${design.stats.components}`,
      `Nets:        ${design.stats.nets}`,
      `Routed:      ${design.stats.routedTraces} PCB traces, ${design.stats.vias} vias, ${design.stats.holes} holes`,
      '',
      'CONTENTS',
      '-'.repeat(34),
      'fabrication/    Gerber X2 + Excellon drill files, ready for upload',
      'assembly/       bom.csv and pick-and-place.csv',
      'design/         circuit.tsx (tscircuit source) and circuit.json',
      'verification/   checks.json, the full check report',
      'manifest.json   design hash, model, tool versions, board geometry, colours, check results',
      '',
      'HOW TO ORDER',
      '-'.repeat(34),
      '1. Upload every file in fabrication/ (including the .drl drill file).',
      '2. Board outline: Edge_Cuts. Layers: see manifest.json → board.layers.',
      '3. Solder mask colour: ' + manifest.board.solderMaskColor + '. Silkscreen: ' + manifest.board.silkscreenColor + '.',
      '4. Minimum trace/space for this preset: ' + preset.minTraceMm + ' / ' + preset.minSpaceMm + ' mm.',
      '5. Minimum drill: ' + preset.minHoleMm + ' mm. Minimum annular ring: ' + preset.minAnnularRingMm + ' mm.',
      '',
      'IMPORTANT',
      '-'.repeat(34),
      DISCLAIMER,
    ].join('\n'),
  )

  const data = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return {
    filename: `${bundleFilename(design.slug, design.designHash)}-${'fab'}.zip`,
    data,
    manifest,
  }
}

/** Individual downloadable artefacts. */
export async function buildIndividualFiles(
  design: DesignResult,
): Promise<Array<{ path: string; mime: string; data: string | Uint8Array }>> {
  const circuitJson = design.circuitJson as never
  const files: Array<{ path: string; mime: string; data: string | Uint8Array }> = [
    { path: 'design/circuit.json', mime: 'application/json', data: JSON.stringify(design.circuitJson, null, 2) },
    { path: 'design/circuit.tsx', mime: 'text/plain; charset=utf-8', data: design.tsx },
    { path: 'manifest.json', mime: 'application/json', data: JSON.stringify(buildManifest(design), null, 2) },
  ]

  const { convertCircuitJsonToGerberFiles, convertCircuitJsonToBomRows, convertBomRowsToCsv, convertCircuitJsonToPickAndPlaceCsv } =
    await loadConverters()

  // Each artefact is wrapped: a converter that fails for one output must not take the
  // others down, and the ZIP already carries an `*-error.txt` explaining what went wrong.
  const attempt = (path: string, mime: string, produce: () => string) => {
    try {
      files.push({ path, mime, data: produce() })
    } catch {
      /* not available for this design; the bundle's error file records it */
    }
  }

  try {
    const gerbers = convertCircuitJsonToGerberFiles(circuitJson)
    for (const [name, body] of Object.entries(gerbers)) {
      files.push({ path: `fabrication/${safeFilename(name)}`, mime: 'text/plain; charset=utf-8', data: body })
    }
  } catch {
    /* gerbers are also in the zip; a failure here must not break the other downloads */
  }

  const addBom = async () => {
    const rows = await convertCircuitJsonToBomRows({ circuitJson })
    return convertBomRowsToCsv(rows)
  }
  try {
    files.push({ path: 'assembly/bom.csv', mime: 'text/csv; charset=utf-8', data: await addBom() })
  } catch {
    /* no BOM for this design */
  }
  attempt('assembly/pick-and-place.csv', 'text/csv; charset=utf-8', () =>
    convertCircuitJsonToPickAndPlaceCsv(circuitJson),
  )

  return files
}
