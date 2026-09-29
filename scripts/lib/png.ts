/**
 * A dependency-free PNG encoder.
 *
 * The icon and Open Graph images are built from the same pixel data as the on-page mascot,
 * so they cannot drift from it — but the app must not gain an image library to do that.
 * PNG's baseline format is a zlib stream of scanlines plus three CRC32 chunks, which is
 * about sixty lines and works anywhere Node works.
 */
import { deflateSync } from 'node:zlib'

export type Rgb = [number, number, number]

export class Canvas {
  readonly width: number
  readonly height: number
  private readonly pixels: Uint8Array

  constructor(width: number, height: number, background: Rgb) {
    this.width = width
    this.height = height
    this.pixels = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i += 1) {
      this.pixels[i * 3] = background[0]
      this.pixels[i * 3 + 1] = background[1]
      this.pixels[i * 3 + 2] = background[2]
    }
  }

  set(x: number, y: number, colour: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const offset = (y * this.width + x) * 3
    this.pixels[offset] = colour[0]
    this.pixels[offset + 1] = colour[1]
    this.pixels[offset + 2] = colour[2]
  }

  rect(x: number, y: number, w: number, h: number, colour: Rgb): void {
    for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, colour)
  }

  /** Hard-edged outline drawn *inside* the rectangle, the neobrutalist "border". */
  outline(x: number, y: number, w: number, h: number, thickness: number, colour: Rgb): void {
    this.rect(x, y, w, thickness, colour)
    this.rect(x, y + h - thickness, w, thickness, colour)
    this.rect(x, y, thickness, h, colour)
    this.rect(x + w - thickness, y, thickness, h, colour)
  }

  /** A solid drop shadow offset down-right, the design system's 6/3/9 px shadow. */
  shadow(x: number, y: number, w: number, h: number, offset: number, colour: Rgb): void {
    this.rect(x + offset, y + offset, w, h, colour)
  }

  toPng(): Buffer {
    const stride = this.width * 3
    const raw = Buffer.alloc((stride + 1) * this.height)
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0 // filter type 0 (None)
      Buffer.from(this.pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
    }

    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(this.width, 0)
    ihdr.writeUInt32BE(this.height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // colour type: truecolour RGB
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
}

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

export function hexToRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}
