/**
 * AUDIT §5.3 — one malformed footprinter string disables autorouting for the WHOLE board.
 */
import { compileAndReport } from './_runner'

const build = (header: string) => `
export default () => (
  <board width="40mm" height="25mm">
    ${header}
    <resistor name="R1" resistance="330" footprint="0603" pcbX={0} pcbY={0} schX={0} schY={0} />
    <led name="LED1" footprint="0603" pcbX={12} pcbY={0} schX={6} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)
`

await compileAndReport('footprint="pinrow2_p1.27" (no unit -> degenerate)', build('<pinheader name="J1" pinCount={2} footprint="pinrow2_p1.27" pcbX={-15} pcbY={0} schX={-8} schY={0} />'))
await compileAndReport('footprint="pinrow2" (default 2.54mm)', build('<pinheader name="J1" pinCount={2} footprint="pinrow2" pcbX={-15} pcbY={0} schX={-8} schY={0} />'))
await compileAndReport('footprint="pinrow2_p2.54mm"', build('<pinheader name="J1" pinCount={2} footprint="pinrow2_p2.54mm" pcbX={-15} pcbY={0} schX={-8} schY={0} />'))
await compileAndReport('<pinheader pitch="2.54mm" holeDiameter platedDiameter>', build('<pinheader name="J1" pinCount={2} pitch="2.54mm" holeDiameter="1mm" platedDiameter="1.7mm" pcbX={-15} pcbY={0} schX={-8} schY={0} />'))
