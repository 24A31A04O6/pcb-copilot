import { describe, expect, it } from 'vitest'

import {
  ZERO_CHAR_FILL,
  ZERO_FACE_ROWS,
  ZERO_GRID_H,
  ZERO_GRID_W,
  ZERO_MAP,
  ZERO_PALETTE,
  ZERO_STATE_LABEL,
  ZERO_STATES,
  faceRows,
  mapToRects,
  spriteFor,
} from '@/components/zero-sprite'

describe('the ZERO sprite', () => {
  it('is a square 24x24 pixel grid', () => {
    expect(ZERO_GRID_W).toBe(24)
    expect(ZERO_GRID_H).toBe(24)
    expect(ZERO_MAP).toHaveLength(24)
    for (const row of ZERO_MAP) {
      expect(row).toHaveLength(24)
    }
  })

  it('uses only characters that map to a palette colour', () => {
    for (const row of ZERO_MAP) {
      for (const cell of row) {
        expect(cell === '.' || cell in ZERO_CHAR_FILL).toBe(true)
      }
    }
    for (const [, key] of Object.entries(ZERO_CHAR_FILL)) {
      expect(key in ZERO_PALETTE).toBe(true)
    }
  })

  it('defines a labelled pose for every state the UI can request', () => {
    for (const state of ZERO_STATES) {
      expect(ZERO_STATE_LABEL[state]).toBeTruthy()
      expect(ZERO_STATE_LABEL[state].length).toBeGreaterThan(2)
    }
  })

  it('covers the five face rows so a blink or a smile has somewhere to draw', () => {
    expect([...ZERO_FACE_ROWS].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14])
  })

  it('gives every state a face, and draws it only on the five face rows', () => {
    const face = [...ZERO_FACE_ROWS].sort((a, b) => a - b)
    for (const state of ZERO_STATES) {
      const rows = faceRows(state)
      expect(rows).toHaveLength(ZERO_GRID_H)
      for (const row of rows) expect(row).toHaveLength(ZERO_GRID_W)
      for (const y of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
        if (face.includes(y)) continue
        expect(rows[y]).toBe('.'.repeat(ZERO_GRID_W))
      }
      expect(face.some((y) => rows[y] !== '.'.repeat(ZERO_GRID_W))).toBe(true)
    }
  })

  it('gives every state a sprite that is still a 24x24 grid', () => {
    for (const state of ZERO_STATES) {
      const sprite = spriteFor(state)
      expect(sprite).toHaveLength(ZERO_GRID_H)
      for (const row of sprite) expect(row).toHaveLength(ZERO_GRID_W)
    }
  })

  it('renders to merged runs and never emits a zero-width or negative rect', () => {
    for (const state of ZERO_STATES) {
      const rects = mapToRects(spriteFor(state))
      expect(rects.length).toBeGreaterThan(0)
      for (const rect of rects) {
        expect(rect.w).toBeGreaterThan(0)
        expect(rect.h).toBe(1)
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.w).toBeLessThanOrEqual(ZERO_GRID_W)
        expect(rect.fill).toMatch(/^#[0-9A-F]{6}$/i)
      }
    }
  })

  it('does not mutate the shared map when building a state sprite', () => {
    const before = ZERO_MAP.join('|')
    spriteFor('success')
    spriteFor('error')
    expect(ZERO_MAP.join('|')).toBe(before)
  })
})
