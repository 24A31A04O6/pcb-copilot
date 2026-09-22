import { z } from 'zod'

export const designRequestSchema = z.object({
  messages: z
    .array(z.string().trim().min(1).max(4_000))
    .min(1)
    .max(20)
    .refine(
      (msgs) => {
        const total = msgs.join('').length
        return total <= 20_000
      },
      { message: 'Total conversation too long (max 20k chars)' },
    ),
  allowClarification: z.boolean().default(true),
})

export type DesignRequestBody = z.infer<typeof designRequestSchema>

export const exportRequestSchema = z.object({
  tsx: z.string().min(1).max(80_000),
  summary: z.string().max(2_000).default('Generated PCB design'),
  assumptions: z.array(z.string().max(1_000)).max(30).default([]),
})

export type ExportRequestBody = z.infer<typeof exportRequestSchema>

export const reviewRequestSchema = z.object({
  tsx: z.string().min(1).max(80_000),
})

export type ReviewRequestBody = z.infer<typeof reviewRequestSchema>
