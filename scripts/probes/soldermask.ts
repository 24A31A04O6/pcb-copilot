/**
 * AUDIT §5.1 — does <board solderMaskColor> reach Circuit JSON in the installed version?
 * (tscircuit/tscircuit#3277 reported it as silently dropped in May 2026)
 */
import { runTscircuitCode } from '@tscircuit/eval'

const code = `
export default () => (
  <board width="30mm" height="20mm" solderMaskColor="black" silkscreenColor="white">
    <resistor name="R1" resistance="330" footprint="0603" pcbX={-5} pcbY={0} schX={0} schY={0} />
    <led name="LED1" color="red" footprint="0603" pcbX={5} pcbY={0} schX={4} schY={0} />
    <trace from=".R1 > .pin1" to=".LED1 > .anode" />
    <trace from=".R1 > .pin2" to=".LED1 > .cathode" />
  </board>
)
`
const circuitJson = await runTscircuitCode(code)
const board = circuitJson.find((e) => e.type === 'pcb_board')
console.log('pcb_board:', JSON.stringify(board, null, 2))
console.log(
  '\nsolder_mask_color propagated:',
  (board as { solder_mask_color?: string } | undefined)?.solder_mask_color === 'black',
)
console.log(
  'silkscreen_color propagated:',
  (board as { silkscreen_color?: string } | undefined)?.silkscreen_color === 'white',
)
