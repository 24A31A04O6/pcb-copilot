import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FAB_PRESET_ID,
  FAB_PRESETS,
  getFabPreset,
  isFabPresetId,
} from '@/lib/server/checks/fab-presets'

describe('fab presets', () => {
  it('covers at least two independent fabricators, each with a source URL', () => {
    const providers = new Set(FAB_PRESETS.map((preset) => preset.provider))
    expect(providers.size).toBeGreaterThanOrEqual(2)
    for (const preset of FAB_PRESETS) {
      expect(preset.source.length).toBeGreaterThan(10)
      expect(preset.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('cites a real URL for every vendor-specific preset', () => {
    for (const preset of FAB_PRESETS) {
      if (preset.source.startsWith('http')) {
        expect(() => new URL(preset.source)).not.toThrow()
        expect(preset.source.startsWith('https://')).toBe(true)
      }
    }
  })

  it('has plausible, ordered process limits', () => {
    for (const preset of FAB_PRESETS) {
      expect(preset.minTraceMm).toBeGreaterThan(0)
      expect(preset.minSpaceMm).toBeGreaterThan(0)
      expect(preset.minHoleMm).toBeLessThan(preset.maxHoleMm)
      expect(preset.minViaPadMm).toBeGreaterThan(preset.minHoleMm)
      expect(preset.minAnnularRingMm).toBeGreaterThan(0)
      expect(preset.minBoardSideMm).toBeLessThan(preset.maxBoardSideMm)
      expect(preset.maxLayers).toBeGreaterThanOrEqual(1)
    }
  })

  it('makes the default preset at least as strict as every other preset', () => {
    const strictest = FAB_PRESETS.find((preset) => preset.id === DEFAULT_FAB_PRESET_ID)!
    for (const preset of FAB_PRESETS) {
      if (preset.id === strictest.id) continue
      expect(strictest.minTraceMm).toBeGreaterThanOrEqual(preset.minTraceMm)
      expect(strictest.minSpaceMm).toBeGreaterThanOrEqual(preset.minSpaceMm)
      expect(strictest.minHoleMm).toBeGreaterThanOrEqual(preset.minHoleMm)
      expect(strictest.minBoardEdgeClearanceMm).toBeGreaterThanOrEqual(preset.minBoardEdgeClearanceMm)
    }
  })

  it('gives every preset a unique id', () => {
    expect(new Set(FAB_PRESETS.map((p) => p.id)).size).toBe(FAB_PRESETS.length)
  })

  it('falls back to the default for an unknown or missing id rather than throwing', () => {
    expect(getFabPreset('nope').id).toBe(DEFAULT_FAB_PRESET_ID)
    expect(getFabPreset(null).id).toBe(DEFAULT_FAB_PRESET_ID)
    expect(getFabPreset(undefined).id).toBe(DEFAULT_FAB_PRESET_ID)
    expect(getFabPreset('').id).toBe(DEFAULT_FAB_PRESET_ID)
    expect(isFabPresetId(DEFAULT_FAB_PRESET_ID)).toBe(true)
    expect(isFabPresetId('nope')).toBe(false)
  })
})
