/**
 * Render the ZERO sprite sheet to a PNG so the artwork can actually be looked at.
 *
 * The mascot is authored as a character map, so "does it look right?" is a question about
 * pixels, not about code. This renders every state side by side at a pixel scale that
 * makes a one-column misalignment obvious. No image dependency: the PNG is written with
 * zlib and a hand-rolled chunk writer, so the check runs anywhere Node runs.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

import {
  ZERO_CHAR_FILL,
  ZERO_GRID_H,
  ZERO_GRID_W,
  ZERO_PALETTE,
  ZERO_STATES,
  spriteFor,
} from '@/components/zero-sprite'

const SCALE = Number(process.env.SCALE ?? 12)
const GAP = 4
const W = ZERO_GRID_W * SCALE * ZERO_STATES.length + GAP * (ZERO_STATES.length - 1)
const H = ZERO_GRID_H * SCALE

const pixels = new Uint8Array(W * H * 3)

function paint(x: number, y: number, hex: string): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const offset = (y * W + x) * 3
  pixels[offset] = parseInt(hex.slice(1, 3), 16)
  pixels[offset + 1] = parseInt(hex.slice(3, 5), 16)
  pixels[offset + 2] = parseInt(hex.slice(5, 7), 16)
}

for (let i = 0; i < W * H; i += 1) paint(i % W, Math.floor(i / W), '#F2FBFC')

ZERO_STATES.forEach((state, index) => {
  const sprite = spriteFor(state)
  const originX = index * (ZERO_GRID_W * SCALE + GAP)
  for (let y = 0; y < ZERO_GRID_H; y += 1) {
    for (let x = 0; x < ZERO_GRID_W; x += 1) {
      const cell = sprite[y]?.[x]
      if (!cell || cell === '.') continue
      const key = ZERO_CHAR_FILL[cell]
      if (!key) throw new Error(`state ${state}: cell "${cell}" at ${x},${y} has no palette entry`)
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) paint(originX + x * SCALE + dx, y * SCALE + dy, ZERO_PALETTE[key])
      }
    }
  }
})

const CRC_TABLE = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, checksum])
}

const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0
  Buffer.from(pixels.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 2

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const target = process.argv[2] ?? '/tmp/zero-states.png'
writeFileSync(target, png)
console.log(`wrote ${target} — ${W}x${H}, states: ${ZERO_STATES.join(', ')}`)
