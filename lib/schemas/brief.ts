import { z } from 'zod/v4'

/**
 * The single source of truth for Stage A.
 *
 * `briefSchema` is used to validate the model's output at runtime, and
 * `BRIEF_JSON_SCHEMA` is generated from that *same* object with `z.toJSONSchema`, so the
 * grammar handed to Fireworks and the validator can never drift.
 *
 * Numeric bounds and enums are deliberate: they stop the model from proposing a
 * 4-metre board, a 400 A rail, or a 12-layer stackup.
 */

const layerCount = z
  .union([z.literal(1), z.literal(2), z.literal(4)])
  .describe('Copper layer count. 2 is the default for a hobby/prototype fab preset.')

const shortText = z.string().trim().min(1).max(240)
const mediumText = z.string().trim().min(1).max(600)

export const boardSchema = z
  .object({
    width_mm: z.number().min(10).max(200).describe('Board width in millimetres.'),
    height_mm: z.number().min(10).max(200).describe('Board height in millimetres.'),
    layers: layerCount,
    thickness_mm: z
      .number()
      .min(0.6)
      .max(3.2)
      .describe('Finished board thickness. 1.6 mm is the common default.'),
  })
  .describe('Physical board envelope and stack-up.')

export const railSchema = z.object({
  name: shortText.describe('Rail name, e.g. +3V3, +5V, VBAT.'),
  voltage_v: z.number().min(0.5).max(60).describe('Nominal rail voltage in volts.'),
  max_current_a: z.number().min(0.001).max(20).describe('Maximum continuous current in amperes.'),
})

export const componentSchema = z.object({
  ref: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{1,4}\d{1,3}$/, 'Reference designator such as R1, C1, U1, J1, D1, Q1.')
    .describe('Reference designator.'),
  kind: z
    .enum([
      'resistor',
      'capacitor',
      'inductor',
      'diode',
      'led',
      'mosfet',
      'transistor',
      'ic',
      'connector',
      'crystal',
      'switch',
      'regulator',
      'sensor',
      'module',
      'testpoint',
    ])
    .describe('Component category.'),
  value: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe('Value string, e.g. 10k, 100nF, 5V, AMS1117-3.3.'),
  footprint: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe(
      't-scfootprint / footprinter string, e.g. 0402, 0603, soic8, pinrow2_p2.54mm, sot23.',
    ),
  purpose: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .describe('Why this part is on the board, in one sentence.'),
})

export const interfaceSchema = z.object({
  name: shortText.describe('Interface name, e.g. USB-C, I2C, SPI, UART.'),
  purpose: mediumText,
  pins: z
    .array(z.string().trim().min(1).max(40))
    .max(12)
    .describe('Signal or pin names carried by the interface.'),
})

export const briefSchema = z
  .object({
    title: z.string().trim().min(3).max(90).describe('Short design title.'),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(1_400)
      .describe('Two or three sentences describing the board and what it must do.'),
    board: boardSchema,
    power: z.object({
      input_voltage_v: z
        .number()
        .min(1)
        .max(60)
        .describe('Voltage arriving at the board input connector.'),
      rails: z.array(railSchema).min(1).max(6).describe('Power rails the board must produce or consume.'),
    }),
    components: z.array(componentSchema).min(1).max(40).describe('The bill of materials.'),
    interfaces: z.array(interfaceSchema).max(8).describe('External interfaces exposed by the board.'),
    constraints: z
      .array(mediumText)
      .max(12)
      .describe('Hard engineering constraints, e.g. max board size, current limits, connectors.'),
    assumptions: z
      .array(mediumText)
      .max(12)
      .describe('Explicit engineering assumptions made where the brief was silent.'),
    open_questions: z
      .array(z.string().trim().min(1).max(240))
      .max(6)
      .describe('Questions that remain unanswered. Empty when the brief is complete enough.'),
  })
  .describe('A complete, buildable PCB design brief.')

export type DesignBrief = z.infer<typeof briefSchema>

/**
 * The JSON Schema sent to Fireworks as `response_format.json_schema.schema` *and*
 * embedded in the system prompt. Generated from `briefSchema`, never hand-written.
 */
export const BRIEF_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(briefSchema, {
  io: 'output',
  unrepresentable: 'any',
}) as Record<string, unknown>

export const BRIEF_SCHEMA_NAME = 'design_brief'

/** Compact single-line rendering for the prompt. */
export const BRIEF_SCHEMA_PROMPT_TEXT = JSON.stringify(BRIEF_JSON_SCHEMA)

/**
 * Clamp a model-produced brief into a range the toolchain can actually compile.
 * Runs after Zod validation, so every field is already present and well-typed.
 */
export function clampBrief(brief: DesignBrief): DesignBrief {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number(value.toFixed(3))))

  return {
    ...brief,
    title: brief.title.slice(0, 90),
    summary: brief.summary.slice(0, 1_400),
    board: {
      width_mm: clamp(brief.board.width_mm, 10, 200),
      height_mm: clamp(brief.board.height_mm, 10, 200),
      layers: brief.board.layers,
      thickness_mm: clamp(brief.board.thickness_mm, 0.6, 3.2),
    },
    power: {
      input_voltage_v: clamp(brief.power.input_voltage_v, 1, 60),
      rails: brief.power.rails.map((rail) => ({
        ...rail,
        voltage_v: clamp(rail.voltage_v, 0.5, 60),
        max_current_a: clamp(rail.max_current_a, 0.001, 20),
      })),
    },
    components: brief.components.slice(0, 40),
    interfaces: brief.interfaces.slice(0, 8),
    constraints: brief.constraints.slice(0, 12),
    assumptions: brief.assumptions.slice(0, 12),
    open_questions: brief.open_questions.slice(0, 6),
  }
}

/** Render a brief for the Stage B prompt. */
export function briefToPrompt(brief: DesignBrief): string {
  const lines: string[] = [
    `Title: ${brief.title}`,
    `Summary: ${brief.summary}`,
    '',
    `Board: ${brief.board.width_mm} x ${brief.board.height_mm} mm, ${brief.board.layers} layer(s), ${brief.board.thickness_mm} mm thick.`,
    `Input supply: ${brief.power.input_voltage_v} V`,
    'Power rails:',
    ...brief.power.rails.map((r) => `  - ${r.name} = ${r.voltage_v} V, up to ${r.max_current_a} A`),
    '',
    'Components:',
    ...brief.components.map(
      (c) => `  - ${c.ref} (${c.kind}) ${c.value} [${c.footprint}] — ${c.purpose}`,
    ),
  ]
  if (brief.interfaces.length) {
    lines.push('', 'Interfaces:')
    for (const i of brief.interfaces) {
      lines.push(`  - ${i.name}: ${i.purpose}${i.pins.length ? ` (${i.pins.join(', ')})` : ''}`)
    }
  }
  if (brief.constraints.length) {
    lines.push('', 'Constraints:')
    for (const c of brief.constraints) lines.push(`  - ${c}`)
  }
  if (brief.assumptions.length) {
    lines.push('', 'Assumptions already made (do not re-ask):')
    for (const a of brief.assumptions) lines.push(`  - ${a}`)
  }
  if (brief.open_questions.length) {
    lines.push('', 'Still unanswered (design conservatively around them):')
    for (const q of brief.open_questions) lines.push(`  - ${q}`)
  }
  return lines.join('\n')
}
