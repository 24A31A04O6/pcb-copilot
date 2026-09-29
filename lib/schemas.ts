import { z } from 'zod/v4'

/** Client → server contracts. Untrusted input; everything here is bounded. */

// eslint-disable-next-line no-control-regex -- stripping control characters is the job here
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

/**
 * Normalise a user brief: strip control characters (which can smuggle terminal escapes
 * or null bytes into prompts and logs), collapse runs of whitespace, and bound the length.
 */
export function sanitizeBrief(input: string, max = 4_000): string {
  return input
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export const designRequestSchema = z.object({
  brief: z
    .string()
    .min(3, 'Describe the board in at least 3 characters.')
    .max(8_000, 'Brief is too long.')
    .transform((value) => sanitizeBrief(value, 4_000))
    .refine((value) => value.length >= 3, 'Brief is too short after cleaning.'),
  revisionNote: z
    .string()
    .max(1_000)
    .optional()
    .transform((value) => (value ? sanitizeBrief(value, 1_000) : undefined)),
  boardColor: z.string().max(24).default('green'),
  fabPreset: z.string().max(64).default('prototype-hobby-2layer'),
})

export type DesignRequestBody = z.output<typeof designRequestSchema>

export const exportRequestSchema = z.object({
  /**
   * A design hash, not source code. The server looks up its own verified record, so the
   * fabrication gate cannot be bypassed by posting arbitrary TSX.
   */
  designHash: z.string().regex(/^[0-9a-f]{6,64}$/, 'Invalid design hash.'),
  kind: z.enum(['fab-zip', 'circuit-json', 'circuit-tsx', 'manifest', 'bom', 'pnp', 'gerbers']).default('fab-zip'),
})

export type ExportRequestBody = z.output<typeof exportRequestSchema>

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
