/**
 * ZERO — the PCB-Copilot mascot, as inline pixel-art SVG.
 *
 * Everything is `<rect>` cells on a fixed 24x24 grid with `shape-rendering="crispEdges"`,
 * so it stays sharp at any size and never blurs like a scaled raster.
 *
 * The sprite is authored as a character map (one string per row) and emitted as merged
 * horizontal runs: small source, minimal output, and a unit test can assert the grid is
 * rectangular. `scripts/build-icons.mjs` renders the same map to the favicon/OG PNGs, so
 * there is one source of truth for the artwork.
 */

export const ZERO_GRID_W = 24
export const ZERO_GRID_H = 24

/** `.` transparent · `K` ink outline · `W` body white · `B` eye blue · `H` glint · `G` shadow */
export const ZERO_MAP: readonly string[] = [
  '........................',
  '........................',
  '..KKKK..................',
  '..KWWK..................',
  '..KWWK..................',
  '..KKKKK.................',
  '.....KK.KKKKKKKKK.......',
  '......KKWWWWWWWWWK......',
  '.......KWWWWWWWWWK......',
  '.......KWWWWWWWWWKKK....',
  '.......KWHBBWHBBWKKW....',
  '.......KWBBBWBBBWKKW....',
  '.......KWBBBWBBBWKKW....',
  '.......KWWKWWWKWWKKW....',
  '.......KWWWKKKWWWKKK....',
  '.......KWWWWWWWWWKKKK...',
  '.......KWWWWWWWWWKKWK...',
  '........KKKKKKKKK.KKK...',
  '.........KK..KK.........',
  '.........KK..KK.........',
  '........KKKKKKKKK.......',
  '........................',
  '.....GGGGGGGGGGGGGGG....',
  '........................',
]

/** Rows 10–12 and 13–14 are the face; they are replaced per state. */
export const ZERO_FACE_ROWS = new Set([10, 11, 12, 13, 14])

export type ZeroPalette = {
  ink: string
  body: string
  eye: string
  glint: string
  shadow: string
  accent: string
  warn: string
  error: string
  success: string
}

export const ZERO_PALETTE: ZeroPalette = {
  ink: '#0B1B1F',
  body: '#FFFFFF',
  eye: '#1D6BFF',
  glint: '#FFFFFF',
  shadow: '#C7D6DA',
  accent: '#22D3EE',
  warn: '#FFE14D',
  error: '#FF6B6B',
  success: '#5EEAD4',
}

export type ZeroState =
  | 'idle'
  | 'reading'
  | 'compiling'
  | 'checking'
  | 'repairing'
  | 'success'
  | 'error'
  | 'locked'
  | 'unlocked'

/** Every state the UI can put ZERO into. Drives the animation and the tests. */
export const ZERO_STATES: readonly ZeroState[] = [
  'idle',
  'reading',
  'compiling',
  'checking',
  'repairing',
  'success',
  'error',
  'locked',
  'unlocked',
]

export const ZERO_STATE_LABEL: Record<ZeroState, string> = {
  idle: 'Ready',
  reading: 'Reading your brief',
  compiling: 'Writing tscircuit source',
  checking: 'Running checks',
  repairing: 'Repairing failures',
  success: 'Verified',
  error: 'Something went wrong',
  locked: 'Exports locked',
  unlocked: 'Exports unlocked',
}

export type Rect = { x: number; y: number; w: number; h: number; fill: string }

export const ZERO_CHAR_FILL: Record<string, keyof ZeroPalette> = {
  K: 'ink',
  W: 'body',
  B: 'eye',
  H: 'glint',
  G: 'shadow',
  C: 'accent',
  Y: 'warn',
  R: 'error',
  M: 'success',
}

/** Merge each row's identical, adjacent cells into a single run. */
export function mapToRects(
  map: readonly string[],
  palette: ZeroPalette = ZERO_PALETTE,
): Rect[] {
  const rects: Rect[] = []
  for (let y = 0; y < map.length; y += 1) {
    const row = map[y] ?? ''
    let x = 0
    while (x < row.length) {
      const cell = row[x]
      if (cell === undefined || cell === '.' || !(cell in ZERO_CHAR_FILL)) {
        x += 1
        continue
      }
      const fill = palette[ZERO_CHAR_FILL[cell]]
      let run = 1
      while (x + run < row.length && row[x + run] === cell) run += 1
      rects.push({ x, y, w: run, h: 1, fill })
      x += run
    }
  }
  return rects
}

/**
 * The face lives in a 9x5 window inside the head, at rows 10-14 and columns FACE_X..
 * FACE_X + FACE_W - 1. The head's outline is ink at column 7 on the left and 17-20 on the
 * right, so anything drawn outside that window crosses the outline and the mascot reads as
 * broken. Authoring the faces as a 9-wide template and expanding it here is what keeps that
 * from happening by accident.
 */
const FACE_W = 9
const FACE_H = 5
const FACE_X = 8
const FACE_Y = 10

/** `.` transparent · `K` ink · `B` eye · `H` glint */
const FACES: Record<ZeroState, readonly string[]> = {
  idle: ['.BB...BB.', '.BB...BB.', '.........', '..KKKKK..', '.........'],
  reading: ['BB.....BB', '.BB...BB.', '.........', '..KKKKK..', '.........'],
  compiling: ['.KK...KK.', '.BB...BB.', '.KKKKKKK.', '.........', '.........'],
  checking: ['.BBB.BBB.', '.BB...BB.', '.........', '..KKKKK..', '.........'],
  repairing: ['.BB...KK.', '.BB......', '.........', '..KKKKK..', '.........'],
  success: ['.K.....K.', 'K.K...K.K', '.........', '...KKK...', '.........'],
  error: ['K.K...K.K', '.K.....K.', 'K.K...K.K', '.........', '..KKKKK..'],
  locked: ['.........', '.KKK.KKK.', '.........', '..KKKKK..', '.........'],
  unlocked: ['HB.....BH', '.BB...BB.', '.........', '..KKKKK..', '.........'],
}

/** Expand one state's 9x5 template into the five 24-wide rows it occupies. */
export function faceRows(state: ZeroState): string[] {
  const face = FACES[state]
  if (face.length !== FACE_H) {
    throw new Error(`face for "${state}" has ${face.length} rows, expected ${FACE_H}`)
  }
  return Array.from({ length: ZERO_GRID_H }, (_, y) => {
    const index = y - FACE_Y
    if (index < 0 || index >= FACE_H) return '.'.repeat(ZERO_GRID_W)
    const row = face[index]
    if (row.length !== FACE_W) {
      throw new Error(`face row ${index} for "${state}" is ${row.length} wide, expected ${FACE_W}`)
    }
    return '.'.repeat(FACE_X) + row + '.'.repeat(ZERO_GRID_W - FACE_X - FACE_W)
  })
}

/**
 * Full sprite for a state: the static body with the face rows swapped in.
 *
 * `faceRows` already returns rows positioned on the 24x24 grid, so the swap is a plain
 * index copy — no arithmetic that could drift away from the face window.
 */
export function spriteFor(state: ZeroState): string[] {
  const face = faceRows(state)
  return ZERO_MAP.map((row, y) => (y >= FACE_Y && y < FACE_Y + FACE_H ? face[y] : row))
}
