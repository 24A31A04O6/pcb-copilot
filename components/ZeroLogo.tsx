import { mapToRects, spriteFor, ZERO_PALETTE } from '@/components/zero-sprite'

/**
 * The ZERO pixel wordmark, drawn from the same 5x7 pixel font as the favicon so the logo
 * and the mascot can never drift apart.
 */

const GLYPHS: Record<string, string[]> = {
  Z: ['ZZZZZ', '....Z', '...Z.', '..Z..', '.Z...', 'ZZZZZ'],
  E: ['EEEEE', 'E....', 'E....', 'EEEE.', 'E....', 'E....', 'EEEEE'],
  R: ['RRRR.', 'R...R', 'R...R', 'RRRR.', 'R.R..', 'R..R.', 'R...R'],
  O: ['.OOO.', 'O...O', 'O...O', 'O...O', 'O...O', 'O...O', '.OOO.'],
}

const WORD = ['Z', 'E', 'R', 'O']
const CELL = 1
const GAP = 1
const HEIGHT = 7

function wordmarkRects(): Array<{ x: number; y: number; w: number; h: number; fill: string }> {
  const rects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = []
  let offsetX = 0
  for (const letter of WORD) {
    const glyph = GLYPHS[letter]
    glyph.forEach((row, y) => {
      let x = 0
      while (x < row.length) {
        if (row[x] === letter) {
          let run = 1
          while (row[x + run] === letter) run += 1
          rects.push({
            x: offsetX + x * CELL,
            y: y * CELL,
            w: run * CELL,
            h: CELL,
            fill: ZERO_PALETTE.ink,
          })
          x += run
        } else {
          x += 1
        }
      }
    })
    offsetX += 5 + GAP
  }
  return rects
}

export function ZeroLogo({ size = 96 }: { size?: number }) {
  const width = 5 * 4 + GAP * 3
  const rects = wordmarkRects()
  return (
    <svg
      width={size * (width / HEIGHT)}
      height={size}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="ZERO"
      data-testid="zero-wordmark"
    >
      {rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.y}`}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          fill={rect.fill}
        />
      ))}
    </svg>
  )
}

/** The favicon / apple-icon source: mascot + wordmark on a cyan tile. */
export function ZeroIconSvg(size = 32): string {
  const mascot = mapToRects(spriteFor('idle'), ZERO_PALETTE)
  const body = mascot
    .map(
      (rect) =>
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${rect.fill}"/>`,
    )
    .join('')
  const word = wordmarkRects()
    .map(
      (rect) =>
        `<rect x="${rect.x + 25}" y="${rect.y + 16}" width="${rect.w}" height="${rect.h}" fill="#0B1B1F"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="32" height="32" fill="#22D3EE"/>${body}${word}</svg>`
}

export default ZeroLogo
