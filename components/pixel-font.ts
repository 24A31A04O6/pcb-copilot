/**
 * A 5x7 pixel font.
 *
 * Used to draw the ZERO wordmark, the favicon and the Open Graph card, so the wordmark
 * glyphs in `ZeroLogo.tsx`, the on-page mascot and the social preview are one source of
 * truth rather than three hand-drawn approximations.
 *
 * Every glyph is exactly 5 columns by 7 rows, `#` being ink.
 */
export const GLYPH_W = 5
export const GLYPH_H = 7

export const PIXEL_FONT: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.####|#....|#....|#....|#....|#....|.####',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.####|#....|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|.##..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  "'": '..#..|..#..|.....|.....|.....|.....|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
}

export type GlyphRect = { x: number; y: number; w: number; h: number }

/** Width in font cells of `text`, including the 1-cell gap between glyphs. */
export function textWidth(text: string, tracking = 1): number {
  if (text.length === 0) return 0
  return text.length * GLYPH_W + (text.length - 1) * tracking
}

/**
 * Lay `text` out at `scale` device pixels per cell, merging horizontal runs so the renderer
 * emits a handful of rectangles instead of one per pixel.
 */
export function textRects(text: string, scale: number, tracking = 1): GlyphRect[] {
  const rects: GlyphRect[] = []
  let cursor = 0
  for (const character of text.toUpperCase()) {
    const glyph = PIXEL_FONT[character]
    if (!glyph) {
      // An unmapped character is a build-time mistake, not something to render as noise.
      throw new Error(`pixel font has no glyph for "${character}"`)
    }
    glyph.split('|').forEach((row, y) => {
      let x = 0
      while (x < row.length) {
        if (row[x] !== '#') {
          x += 1
          continue
        }
        let run = 1
        while (row[x + run] === '#') run += 1
        rects.push({ x: (cursor + x) * scale, y: y * scale, w: run * scale, h: scale })
        x += run
      }
    })
    cursor += GLYPH_W + tracking
  }
  return rects
}
