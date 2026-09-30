/**
 * Solder-mask colour presets.
 *
 * The hex values are realistic mask inks, not saturated web colours: a real FR-4 mask is
 * a pigmented epoxy layer and never reads as a pure hue. Silkscreen colour is derived
 * from the mask luminance so contrast is automatic (white on dark masks, black on light).
 */

export type BoardColor = {
  id: string
  label: string
  /** tscircuit <board solderMaskColor> preset name (e.g. "blue"). */
  mask: string
  /**
   * The realistic mask ink handed to `<board solderMaskColor>` and to the 3D viewer.
   * `@tscircuit/3d-viewer` accepts any CSS hex, and passes it to
   * `resolveSoldermaskColor()`, which feeds both the substrate colour and the solder-mask
   * texture. Using the hex rather than the preset name is what makes a "muted forest
   * green" instead of the viewer's default bright green.
   */
  hex: string
  /** Silkscreen chosen automatically for contrast. */
  silk: string
  silkHex: string
  /** Relative luminance of the mask, used to pick the silkscreen. */
  luminance: number
  /** CSS filter fallback, only used if neither the prop nor the scene walk works. */
  cssFilter: string
}

function srgbChannel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6)
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return 1
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
}

function contrastRatio(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

const WHITE_INK = { name: 'white', hex: '#FFFFFF' }
const BLACK_INK = { name: 'black', hex: '#0B1B1F' }

/**
 * Pick the ink with the higher contrast against this mask.
 *
 * A fixed luminance cut-off is not enough: a saturated mid mask such as yellow
 * (#C9A227) is dark enough to be called "dark" and far too light to take white ink —
 * it lands at 2.4:1 with white and 8.7:1 with black. Comparing both inks directly is
 * both simpler and provably the best of the two, and a tie goes to white, which is
 * what a board house stocks.
 */
export function pickSilkscreen(maskHex: string): { name: string; hex: string } {
  const maskLuminance = relativeLuminance(maskHex)
  const onWhite = contrastRatio(maskLuminance, relativeLuminance(WHITE_INK.hex))
  const onBlack = contrastRatio(maskLuminance, relativeLuminance(BLACK_INK.hex))
  return onBlack > onWhite ? BLACK_INK : WHITE_INK
}

type Seed = { id: string; label: string; mask: string; hex: string; cssFilter: string }

const SEEDS: Seed[] = [
  // Classic 0.5 oz green: a muted forest green, not neon.
  { id: 'green', label: 'Green', mask: 'green', hex: '#0F4F30', cssFilter: 'hue-rotate(0deg) saturate(1)' },
  { id: 'blue', label: 'Blue', mask: 'blue', hex: '#17325C', cssFilter: 'hue-rotate(200deg) saturate(1.15)' },
  { id: 'red', label: 'Red', mask: 'red', hex: '#7A1F1F', cssFilter: 'hue-rotate(330deg) saturate(1.2)' },
  { id: 'black', label: 'Black (matte)', mask: 'black', hex: '#1C1C1E', cssFilter: 'grayscale(1) brightness(0.55)' },
  { id: 'white', label: 'White', mask: 'white', hex: '#EDEDEA', cssFilter: 'grayscale(1) brightness(1.5)' },
  { id: 'yellow', label: 'Yellow', mask: 'yellow', hex: '#C9A227', cssFilter: 'hue-rotate(15deg) saturate(1.1)' },
  { id: 'purple', label: 'Purple', mask: 'purple', hex: '#3B2A5A', cssFilter: 'hue-rotate(255deg) saturate(1.2)' },
]

export const BOARD_COLORS: BoardColor[] = SEEDS.map((seed) => {
  const silk = pickSilkscreen(seed.hex)
  return {
    id: seed.id,
    label: seed.label,
    mask: seed.mask,
    hex: seed.hex.toUpperCase(),
    silk: silk.name,
    silkHex: silk.hex.toUpperCase(),
    luminance: Number(relativeLuminance(seed.hex).toFixed(4)),
    cssFilter: seed.cssFilter,
  }
})

export const DEFAULT_BOARD_COLOR_ID = 'green'

export function getBoardColor(id: string | null | undefined): BoardColor {
  if (!id) return BOARD_COLORS[0]
  return BOARD_COLORS.find((color) => color.id === id) ?? BOARD_COLORS[0]
}

export function isBoardColorId(id: string): boolean {
  return BOARD_COLORS.some((color) => color.id === id)
}

/** Contrast of the chosen silkscreen against the mask. Used by the a11y test. */
export function silkscreenContrast(color: BoardColor): number {
  return Number(contrastRatio(relativeLuminance(color.hex), relativeLuminance(color.silkHex)).toFixed(2))
}

/**
 * Write the solder-mask colour into every `pcb_board` in a Circuit JSON array.
 *
 * This is the shipped colour path (Phase 4, "path 1"): the colour is a property of
 * Circuit JSON, and `@tscircuit/3d-viewer@0.0.598` reads `pcb_board.solder_mask_color`
 * for both the board substrate and the solder-mask texture. Returns true when a board was
 * found and updated, so the caller can fall back honestly instead of assuming success.
 */
export function applySolderMask(circuitJson: unknown[], hex: string): boolean {
  if (!Array.isArray(circuitJson)) return false
  let touched = false
  for (const element of circuitJson) {
    if (
      typeof element === 'object' &&
      element !== null &&
      (element as { type?: string }).type === 'pcb_board'
    ) {
      const board = element as Record<string, unknown>
      board.solder_mask_color = hex
      touched = true
    }
  }
  return touched
}

/** Look up the palette entry for a mask value already stored on a `pcb_board`. */
export function boardColorForHex(hex: string | null | undefined): BoardColor {
  if (!hex) return BOARD_COLORS[0]
  const normalised = hex.toLowerCase()
  return BOARD_COLORS.find((color) => color.hex.toLowerCase() === normalised) ?? BOARD_COLORS[0]
}
