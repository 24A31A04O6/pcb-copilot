/**
 * Fabrication capability presets.
 *
 * The numbers are the published process capabilities of two widely used low-cost fabs
 * (see docs/RESEARCH.md for the URLs and the date they were read). They are deliberately
 * conservative: a design that passes here should be buildable on the cheapest option at
 * the named fab, not merely legal in the fab's best-case stack-up.
 *
 * A design may be checked against any preset; the default is the hobby/prototype preset.
 */

export type FabPreset = {
  id: string
  label: string
  provider: string
  minTraceMm: number
  minSpaceMm: number
  minHoleMm: number
  maxHoleMm: number
  minViaPadMm: number
  minAnnularRingMm: number
  minBoardEdgeClearanceMm: number
  minDrillToCopperMm: number
  maxLayers: number
  minBoardSideMm: number
  maxBoardSideMm: number
  source: string
  checkedOn: string
}

export const FAB_PRESETS: FabPreset[] = [
  {
    id: 'jlcpcb-2layer-standard',
    label: 'JLCPCB 2-layer · standard',
    provider: 'JLCPCB',
    minTraceMm: 0.127,
    minSpaceMm: 0.127,
    minHoleMm: 0.3,
    maxHoleMm: 6.35,
    minViaPadMm: 0.6,
    minAnnularRingMm: 0.13,
    minBoardEdgeClearanceMm: 0.3,
    minDrillToCopperMm: 0.25,
    maxLayers: 2,
    minBoardSideMm: 5,
    maxBoardSideMm: 500,
    source: 'https://jlcpcb.com/capabilities/pcb-capabilities',
    checkedOn: '2026-09-29',
  },
  {
    id: 'jlcpcb-2layer-economy',
    label: 'JLCPCB 2-layer · economy (hand-off check)',
    provider: 'JLCPCB',
    minTraceMm: 0.152,
    minSpaceMm: 0.152,
    minHoleMm: 0.3,
    maxHoleMm: 6.35,
    minViaPadMm: 0.6,
    minAnnularRingMm: 0.15,
    minBoardEdgeClearanceMm: 0.3,
    minDrillToCopperMm: 0.25,
    maxLayers: 2,
    minBoardSideMm: 5,
    maxBoardSideMm: 250,
    source: 'https://jlcpcb.com/capabilities/pcb-capabilities',
    checkedOn: '2026-09-29',
  },
  {
    id: 'jlcpcb-4layer-standard',
    label: 'JLCPCB 4-layer · standard',
    provider: 'JLCPCB',
    // JLCPCB quotes 3.5 mil (0.089 mm) trace/space for 4+ layer boards but has rejected
    // Gerbers at that width in the wild, so this preset holds the line at a round 4 mil.
    minTraceMm: 0.1,
    minSpaceMm: 0.1,
    // JLCPCB's 4-layer minimum drill is 0.2 mm, tighter than the 0.3 mm 2-layer floor.
    minHoleMm: 0.2,
    maxHoleMm: 6.35,
    // Published minimum via is a 0.45 mm pad on a 0.2 mm drill.
    minViaPadMm: 0.5,
    minAnnularRingMm: 0.1,
    minBoardEdgeClearanceMm: 0.3,
    // Hole-to-copper is the number JLCPCB actually enforces: 0.25 mm.
    minDrillToCopperMm: 0.25,
    maxLayers: 6,
    minBoardSideMm: 5,
    maxBoardSideMm: 400,
    source: 'https://jlcpcb.com/blog/pcb-design-rules-best-practices',
    checkedOn: '2026-09-29',
  },
  {
    id: 'pcbway-2layer-standard',
    label: 'PCBWay 2-layer · standard',
    provider: 'PCBWay',
    minTraceMm: 0.127,
    minSpaceMm: 0.127,
    minHoleMm: 0.3,
    maxHoleMm: 6.5,
    minViaPadMm: 0.6,
    minAnnularRingMm: 0.15,
    minBoardEdgeClearanceMm: 0.3,
    minDrillToCopperMm: 0.2,
    maxLayers: 2,
    minBoardSideMm: 5,
    maxBoardSideMm: 500,
    source: 'https://www.pcbway.com/capabilities/',
    checkedOn: '2026-09-29',
  },
  {
    id: 'prototype-hobby-2layer',
    label: 'Hobby / prototype 2-layer (default, most conservative)',
    provider: 'Generic low-cost prototype fab',
    minTraceMm: 0.2,
    minSpaceMm: 0.2,
    minHoleMm: 0.4,
    maxHoleMm: 6.0,
    minViaPadMm: 0.8,
    minAnnularRingMm: 0.2,
    minBoardEdgeClearanceMm: 0.5,
    minDrillToCopperMm: 0.3,
    maxLayers: 2,
    minBoardSideMm: 10,
    maxBoardSideMm: 150,
    source: 'Intersection of the JLCPCB and PCBWay 2-layer standard tables',
    checkedOn: '2026-09-29',
  },
]

export const DEFAULT_FAB_PRESET_ID = 'prototype-hobby-2layer'

export function getFabPreset(id: string | null | undefined): FabPreset {
  // Looked up by id, never by index: an earlier version used FAB_PRESETS[3], and adding a
  // preset silently changed which fab every unknown id fell back to.
  const fallback = FAB_PRESETS.find((preset) => preset.id === DEFAULT_FAB_PRESET_ID)
  if (!fallback) {
    throw new Error(`FAB_PRESETS is missing the default preset "${DEFAULT_FAB_PRESET_ID}"`)
  }
  if (!id) return fallback
  return FAB_PRESETS.find((preset) => preset.id === id) ?? fallback
}

export function isFabPresetId(id: string): boolean {
  return FAB_PRESETS.some((p) => p.id === id)
}
