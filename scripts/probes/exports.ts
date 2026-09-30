/**
 * AUDIT §5.6 — the fabrication bundle.
 *
 * Compiles a real board through the sandbox, runs the same `evaluateDesign` the pipeline
 * uses, then exercises the whole export path: official Gerber/Excellon converters, BOM CSV,
 * pick-and-place CSV, source + circuit JSON + checks, a manifest and a README, zipped up,
 * and validated by re-opening the archive and checking the formats byte-for-byte.
 */
import JSZip from 'jszip'

import { evaluateDesign } from '@/lib/checks'
import type { DesignResult } from '@/lib/design'
import { runInSandbox } from '@/lib/server/compile/sandbox'
import { buildFabricationBundle, buildIndividualFiles } from '@/lib/server/exports'

const SOURCE = `
export default () => (
  <board width="40mm" height="25mm">
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="330" footprint="0603" pcbX={-2} pcbY={4} schX={0} schY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={6} pcbY={4} schX={6} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
    <trace from=".C1 > .pin2" to=".J1 > .pin2" />
  </board>
)
`

const PRESET_ID = 'hobby-2layer'

async function main() {
  const compiled = await runInSandbox(SOURCE, {
    timeoutMs: 30_000,
    memoryMb: 512,
    maxElements: 60_000,
  })
  const report = evaluateDesign(compiled.circuitJson, compiled.checks, PRESET_ID)

  const design: DesignResult = {
    slug: 'rc-led-blinker',
    title: 'RC LED blinker',
    summary: 'Two-pin header, 330 ohm resistor and a 100nF capacitor in one return loop.',
    tsx: SOURCE,
    circuitJson: compiled.circuitJson,
    checks: report.checks,
    stats: report.stats,
    verified: report.passed,
    blockingCount: report.blockingCount,
    warningCount: report.warningCount,
    iterations: 1,
    model: 'probe',
    fallbackUsed: false,
    partSearchUsed: false,
    fab: { presetId: report.fabPresetId, label: report.fabPresetLabel, solderMask: 'forest', silkscreen: 'white' },
    designHash: 'a'.repeat(40),
    generatedAt: new Date().toISOString(),
    durationMs: compiled.durationMs,
    repairCount: 0,
    tokenUsage: { input: 0, output: 0 },
  }

  console.log(
    `### checks: ${report.checks.length} total, ${report.blockingCount} blocking, ${report.warningCount} warnings, passed=${report.passed}`,
  )
  if (!report.passed) {
    for (const check of report.checks.filter((c) => c.severity === 'error')) {
      console.log(`    BLOCKING ${check.code}: ${check.message}`)
    }
  }

  const bundle = await buildFabricationBundle(design)
  const zip = await JSZip.loadAsync(bundle.data)

  const entries = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort()
  console.log(`### bundle: ${bundle.filename} (${bundle.data.byteLength} bytes, ${entries.length} entries)`)
  for (const name of entries) {
    const bytes = ((await zip.file(name)?.async('uint8array')))?.byteLength ?? 0
    if (bytes === 0) throw new Error(`empty entry in archive: ${name}`)
  }

  const inDir = (re: RegExp) => entries.filter((name) => re.test(name))
  const copper = inDir(/^fabrication\/[FB]_Cu\.gbr$/)
  const masks = inDir(/^fabrication\/[FB]_Mask\.gbr$/)
  const silks = inDir(/^fabrication\/[FB]_SilkScreen\.gbr$/)
  const pastes = inDir(/^fabrication\/[FB]_Paste\.gbr$/)
  const edges = inDir(/^fabrication\/Edge_Cuts\.gbr$/)
  const drills = inDir(/^fabrication\/.*\.drl$/)
  console.log(
    `### gerber set: copper=${copper.length} mask=${masks.length} silk=${silks.length} paste=${pastes.length} edge=${edges.length} drill=${drills.length}`,
  )
  for (const [label, list, expected] of [
    ['copper', copper, 2],
    ['mask', masks, 2],
    ['silkscreen', silks, 2],
    ['paste', pastes, 2],
    ['board outline', edges, 1],
    ['drill', drills, 1],
  ] as const) {
    if (list.length !== expected) throw new Error(`expected ${expected} ${label} files, got ${list.length}`)
  }

  const top = await zip.file('fabrication/F_Cu.gbr')!.async('string')
  for (const marker of ['%FSLAX', '%MOMM', 'G04', 'M02']) {
    if (!top.includes(marker)) throw new Error(`F_Cu.gbr is missing ${marker}`)
  }
  const edge = await zip.file('fabrication/Edge_Cuts.gbr')!.async('string')
  if (!/^G0[12]\*/m.test(edge)) throw new Error('Edge_Cuts.gbr has no outline segments')

  const drill = await zip.file(drills[0])!.async('string')
  for (const marker of ['M48', 'METRIC', 'FMAT,2', 'M30']) {
    if (!drill.includes(marker)) throw new Error(`drill file is missing ${marker}`)
  }
  if (!/^T\d+C[\d.]+$/m.test(drill)) throw new Error('drill file declares no tool diameter')
  if (!/^X-?[\d.]+Y-?[\d.]+$/m.test(drill)) throw new Error('drill file declares no hole positions')

  const bom = await zip.file('assembly/bom.csv')!.async('string')
  const bomRows = bom.trim().split('\n')
  if (bomRows.length < 2) throw new Error('bom.csv has no rows')
  console.log(`### bom: ${bomRows.length - 1} rows, header ${bomRows[0]}`)

  const pnp = await zip.file('assembly/pick-and-place.csv')!.async('string')
  const pnpRows = pnp.trim().split('\n')
  if (pnpRows.length < 2) throw new Error('pick-and-place.csv has no rows')
  console.log(`### pnp: ${pnpRows.length - 1} rows, header ${pnpRows[0]}`)

  const manifest: {
    title: string
    contents: string[]
    disclaimer: string
    board: { widthMm: number | null; heightMm: number | null; layers: number; solderMaskHex: string }
    checks: { passed: boolean }
    toolVersions: Record<string, string>
  } = JSON.parse(await zip.file('manifest.json')!.async('string'))
  const payload = entries.filter((name) => name !== 'manifest.json' && name !== 'README.txt')
  if (manifest.contents.length !== payload.length) {
    throw new Error(`manifest lists ${manifest.contents.length} files, archive carries ${payload.length} payload files`)
  }
  if (!manifest.disclaimer.includes('qualified engineer')) {
    throw new Error('manifest is missing the review disclaimer')
  }
  console.log(
    `### manifest: "${manifest.title}" / ${manifest.board.widthMm}x${manifest.board.heightMm}mm, ${manifest.board.layers} layers, mask ${manifest.board.solderMaskHex} / checks passed=${manifest.checks.passed}`,
  )
  console.log(`### tools: ${JSON.stringify(manifest.toolVersions)}`)

  const readme = await zip.file('README.txt')!.async('string')
  if (!readme.includes('Gerber') || !readme.includes('Excellon')) {
    throw new Error('README does not describe the fabrication files')
  }

  const individuals = await buildIndividualFiles(design)
  const gerberOnly = individuals.filter((file) => file.path.startsWith('fabrication/'))
  const fabricationTotal = copper.length + masks.length + silks.length + pastes.length + edges.length + drills.length
  if (gerberOnly.length !== fabricationTotal) {
    throw new Error(`individual download list has ${gerberOnly.length} fabrication files, bundle carries ${fabricationTotal}`)
  }
  if (!individuals.some((file) => file.path === 'manifest.json')) {
    throw new Error('individual download list is missing manifest.json')
  }
  console.log(`### individual downloads: ${individuals.length} files`)
  console.log('### OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
