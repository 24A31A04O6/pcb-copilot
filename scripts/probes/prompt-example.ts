/**
 * AUDIT §5.2 — the "VALID EXAMPLE" shipped in lib/server/prompts.ts.
 * It is the exemplar every generated design is imitated from, so it must itself pass.
 */
import { compileAndReport } from './_runner'

// Verbatim from lib/server/prompts.ts (pre-fix).
const LEGACY_EXAMPLE = `
export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="330" footprint="0603" pcbX={4} pcbY={2} schX={1} schY={1} />
    <led name="LED1" color="red" footprint="0603" pcbX={8} pcbY={2} schX={4} schY={1} />
    <trace from=".R1 .pin2" to=".LED1 .pos" />
    <trace from=".R1 .pin1" to="net.VCC" />
    <trace from=".LED1 .neg" to="net.GND" />
  </board>
)
`

// The replacement exemplar shipped in lib/server/prompts.ts (post-fix).
const FIXED_EXAMPLE = `
export default () => (
  <board width="40mm" height="25mm">
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={-2} schY={0} />
    <led name="LED1" color="red" footprint="0603" pcbX={6} pcbY={0} schX={2} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)
`

await compileAndReport('prompts.ts VALID EXAMPLE (legacy)', LEGACY_EXAMPLE)
await compileAndReport('prompts.ts VALID EXAMPLE (fixed)', FIXED_EXAMPLE)
