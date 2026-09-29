/**
 * Build the static brand assets from the same pixel data the page renders.
 *
 * Writes `public/icon-16.png`, `icon-32.png`, `icon-192.png`, `icon-512.png`,
 * `apple-icon.png` and `og.png` (1200x630). Everything is drawn from `ZERO_MAP`, the pixel
 * font and `BRAND`, so the favicon, the Open Graph card and the on-page mascot cannot drift
 * apart. Run with `pnpm run build:assets`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { mapToRects, spriteFor, ZERO_GRID_H, ZERO_GRID_W, ZERO_PALETTE } from '@/components/zero-sprite'
import { GLYPH_H, GLYPH_W, textRects, textWidth } from '@/components/pixel-font'
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE, BRAND, SHADOWS } from '@/lib/brand'

import { Canvas, hexToRgb, type Rgb } from './lib/png'

const OUT = join(process.cwd(), 'public')

const ink = hexToRgb(BRAND.ink)
const cyan = hexToRgb(BRAND.cyan)
const cyanDeep = hexToRgb(BRAND.cyanDeep)
const paper = hexToRgb(BRAND.paper)
const white = hexToRgb(BRAND.surface)
const success = hexToRgb(BRAND.success)

/** Draw a 24x24 mascot sprite at an integer scale, nearest-neighbour so it stays crisp. */
function drawMascot(canvas: Canvas, state: 'idle' | 'unlocked', x: number, y: number, scale: number): void {
  for (const rect of mapToRects(spriteFor(state), ZERO_PALETTE)) {
    canvas.rect(x + rect.x * scale, y + rect.y * scale, rect.w * scale, rect.h * scale, colourForRect(rect.fill))
  }
}

/** `mapToRects` returns hex fills; map them back once instead of per call. */
const FILL_CACHE = new Map<string, Rgb>()
function colourForRect(hex: string): Rgb {
  const cached = FILL_CACHE.get(hex)
  if (cached) return cached
  const rgb = hexToRgb(hex)
  FILL_CACHE.set(hex, rgb)
  return rgb
}

function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  colour: Rgb,
  tracking = 1,
): number {
  for (const rect of textRects(text, scale, tracking)) {
    canvas.rect(x + rect.x, y + rect.y, rect.w, rect.h, colour)
  }
  return textWidth(text, tracking) * scale
}

/** A hard drop shadow behind a solid block: the design system's signature. */
function brutalPanel(canvas: Canvas, x: number, y: number, w: number, h: number, border: number): void {
  canvas.shadow(x, y, w, h, SHADOWS.md, ink)
  canvas.rect(x, y, w, h, white)
  canvas.outline(x, y, w, h, border, ink)
}

function buildIcon(size: number, state: 'idle' | 'unlocked'): Buffer {
  const canvas = new Canvas(size, size, cyan)
  const inner = Math.round(size * 0.78)
  const offset = Math.round((size - inner) / 2)
  drawMascot(canvas, state, offset, offset, Math.max(1, Math.floor(inner / ZERO_GRID_W)))
  return canvas.toPng()
}

function buildOg(): Buffer {
  const W = 1200
  const H = 630
  const canvas = new Canvas(W, H, paper)

  // A cyan band down the left edge, so the card is recognisable at thumbnail size.
  canvas.rect(0, 0, 24, H, cyan)
  canvas.rect(24, 0, 12, H, ink)

  const M = 72
  // Mascot, in its own shadowed tile.
  const tile = 320
  const tileX = W - M - tile
  const tileY = 96
  canvas.shadow(tileX, tileY, tile, tile, SHADOWS.lg, ink)
  canvas.rect(tileX, tileY, tile, tile, cyan)
  canvas.outline(tileX, tileY, tile, tile, 6, ink)
  drawMascot(canvas, 'unlocked', tileX + 16, tileY + 16, Math.floor((tile - 32) / ZERO_GRID_W))

  // Wordmark.
  const markScale = 14
  drawText(canvas, 'ZERO', M, 96, markScale, ink)
  const markW = textWidth('ZERO') * markScale
  canvas.rect(M, 96 + GLYPH_H * markScale + 18, markW, 6, cyanDeep)

  // Name + tagline.
  let y = 96 + GLYPH_H * markScale + 54
  const nameScale = 6
  drawText(canvas, APP_NAME.toUpperCase().replace('-', ' '), M, y, nameScale, ink)
  y += GLYPH_H * nameScale + 28

  const tagScale = 3
  drawText(canvas, APP_TAGLINE.toUpperCase(), M, y, tagScale, cyanDeep)
  y += GLYPH_H * tagScale + 36

  // Three feature chips, the same hard-border language as the UI.
  const chips = ['GERBERS', 'BOM', 'PICK AND PLACE']
  let chipX = M
  const chipScale = 2
  for (const chip of chips) {
    const w = textWidth(chip) * chipScale + 28
    const h = GLYPH_H * chipScale + 22
    brutalPanel(canvas, chipX, y, w, h, 3)
    drawText(canvas, chip, chipX + 14, y + 11, chipScale, ink)
    chipX += w + 18
  }

  // A short, honest description rather than a marketing superlative.
  const bodyScale = 2
  let bodyY = y + 84
  for (const line of wrap(APP_DESCRIPTION.toUpperCase(), 58)) {
    drawText(canvas, line, M, bodyY, bodyScale, hexToRgb(BRAND.inkSoft))
    bodyY += GLYPH_H * bodyScale + 10
  }

  // A "verified" badge in the corner, the product's core claim.
  const badgeScale = 2
  const badgeText = 'VERIFIED'
  const bw = textWidth(badgeText) * badgeScale + 30
  const bh = GLYPH_H * badgeScale + 22
  const bx = W - M - bw
  const by = H - M - bh
  canvas.shadow(bx, by, bw, bh, SHADOWS.sm, ink)
  canvas.rect(bx, by, bw, bh, success)
  canvas.outline(bx, by, bw, bh, 3, ink)
  drawText(canvas, badgeText, bx + 15, by + 11, badgeScale, ink)

  return canvas.toPng()
}

/** Greedy wrap at a cell count, so a long description never runs off the card. */
function wrap(text: string, cells: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > cells) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** The scalable favicon: the same mascot and wordmark, as SVG. */
function buildIconSvg(): string {
  const mascot = mapToRects(spriteFor('idle'), ZERO_PALETTE)
    .map(
      (rect) =>
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${rect.fill}"/>`,
    )
    .join('')
  const word = textRects('ZERO', 1, 1)
    .map(
      (rect) =>
        `<rect x="${rect.x}" y="${rect.y + 15}" width="${rect.w}" height="${rect.h}" fill="${BRAND.ink}"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ZERO_GRID_W} ${ZERO_GRID_H}" width="32" height="32" shape-rendering="crispEdges" role="img" aria-label="ZERO"><rect width="${ZERO_GRID_W}" height="${ZERO_GRID_H}" fill="${BRAND.cyan}"/>${mascot}${word}</svg>`
}

function main(): void {
  mkdirSync(OUT, { recursive: true })

  const written: Array<[string, Buffer]> = [
    ['icon-16.png', buildIcon(16, 'idle')],
    ['icon-32.png', buildIcon(32, 'idle')],
    ['icon-192.png', buildIcon(192, 'idle')],
    ['icon-512.png', buildIcon(512, 'idle')],
    ['apple-icon.png', buildIcon(180, 'idle')],
    ['og.png', buildOg()],
  ]

  for (const [name, data] of written) {
    writeFileSync(join(OUT, name), data)
    console.log(`public/${name} — ${data.byteLength} bytes`)
  }

  const svg = buildIconSvg()
  writeFileSync(join(OUT, 'icon.svg'), svg)
  console.log(`public/icon.svg — ${svg.length} bytes`)
  console.log(`mascot grid ${ZERO_GRID_W}x${ZERO_GRID_H}, glyph ${GLYPH_W}x${GLYPH_H}`)
}

main()
