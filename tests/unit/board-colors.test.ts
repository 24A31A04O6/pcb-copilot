import { describe, expect, it } from 'vitest'

import {
  BOARD_COLORS,
  DEFAULT_BOARD_COLOR_ID,
  applySolderMask,
  boardColorForHex,
  getBoardColor,
  isBoardColorId,
  pickSilkscreen,
  relativeLuminance,
  silkscreenContrast,
} from '@/lib/board-colors'

describe('the palette', () => {
  it('offers at least the six classic mask colours plus black', () => {
    expect(BOARD_COLORS.length).toBeGreaterThanOrEqual(6)
    for (const id of ['green', 'blue', 'red', 'black', 'white', 'yellow']) {
      expect(isBoardColorId(id)).toBe(true)
    }
  })

  it('uses realistic, desaturated inks rather than pure hues', () => {
    for (const color of BOARD_COLORS) {
      const hex = color.hex
      expect(hex).toMatch(/^#[0-9A-F]{6}$/)
      const [, r, g, b] = hex.match(/#(..)(..)(..)/)!
      const channels = [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)]
      const max = Math.max(...channels)
      const min = Math.min(...channels)
      // A real mask ink is never a fully saturated primary.
      expect(max - min).toBeLessThanOrEqual(0xD0)
    }
  })

  it('gives every mask a silkscreen that clears the WCAG AA large-text threshold', () => {
    for (const color of BOARD_COLORS) {
      expect(silkscreenContrast(color)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('picks whichever ink actually reads better, not a hard luminance cut-off', () => {
    expect(pickSilkscreen('#EDEDEA').name).toBe('black')
    expect(pickSilkscreen('#0F4F30').name).toBe('white')
    // Yellow is the case a threshold gets wrong: white ink on it is only 2.4:1.
    expect(pickSilkscreen('#C9A227').name).toBe('black')
  })

  it('computes luminance with the WCAG formula and survives shorthand hex', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000')).toBeCloseTo(0, 5)
  })

  it('falls back to the default colour for an unknown id', () => {
    expect(getBoardColor('nope').id).toBe(DEFAULT_BOARD_COLOR_ID)
    expect(getBoardColor(null).id).toBe(DEFAULT_BOARD_COLOR_ID)
    expect(getBoardColor(undefined).id).toBe(DEFAULT_BOARD_COLOR_ID)
    expect(getBoardColor('blue').id).toBe('blue')
  })

  it('round-trips a mask hex back to its palette entry', () => {
    const blue = BOARD_COLORS.find((color) => color.id === 'blue')!
    expect(boardColorForHex(blue.hex).id).toBe('blue')
    expect(boardColorForHex(blue.hex.toLowerCase()).id).toBe('blue')
    expect(boardColorForHex('#ABCDEF').id).toBe(DEFAULT_BOARD_COLOR_ID)
    expect(boardColorForHex(null).id).toBe(DEFAULT_BOARD_COLOR_ID)
  })
})

describe('applySolderMask', () => {
  it('writes the colour onto the pcb_board element', () => {
    const circuit = [{ type: 'pcb_board', pcb_board_id: 'b1' }, { type: 'pcb_trace' }]
    expect(applySolderMask(circuit, '#17325C')).toBe(true)
    expect(circuit[0]).toMatchObject({ solder_mask_color: '#17325C' })
  })

  it('leaves every other element untouched', () => {
    const trace = { type: 'pcb_trace', pcb_trace_id: 't1' }
    const circuit = [{ type: 'pcb_board' }, trace, { type: 'source_component', name: 'R1' }]
    applySolderMask(circuit, '#000000')
    expect(trace).toEqual({ type: 'pcb_trace', pcb_trace_id: 't1' })
    expect((circuit[2] as Record<string, unknown>).solder_mask_color).toBeUndefined()
  })

  it('updates every board in the array', () => {
    const circuit = [{ type: 'pcb_board', id: 'a' }, { type: 'pcb_board', id: 'b' }]
    expect(applySolderMask(circuit, '#7A1F1F')).toBe(true)
    expect(circuit.map((element) => (element as Record<string, unknown>).solder_mask_color)).toEqual([
      '#7A1F1F',
      '#7A1F1F',
    ])
  })

  it('reports honestly when there is no board to colour', () => {
    expect(applySolderMask([], '#000000')).toBe(false)
    expect(applySolderMask([{ type: 'pcb_trace' }], '#000000')).toBe(false)
    expect(applySolderMask([null, 'x', 7] as unknown[], '#000000')).toBe(false)
  })

  it('rejects a non-array instead of throwing', () => {
    expect(applySolderMask(null as unknown as unknown[], '#000000')).toBe(false)
    expect(applySolderMask({} as unknown as unknown[], '#000000')).toBe(false)
  })
})
