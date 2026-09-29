/**
 * AUDIT §5.5 — the compile sandbox.
 *
 * Proves three things at once:
 *   1. a valid tscircuit module compiles inside the capped child process
 *   2. a module with an unbounded loop is killed by the wall clock, not by the host
 *   3. the static allow-list rejects source that reaches for anything outside tscircuit
 */
import type { AppError } from '@/lib/errors'
import { assertSafeGeneratedCode, runInSandbox } from '@/lib/server/compile/sandbox'

const GOOD = `
export default () => (
  <board width="40mm" height="25mm">
    <net name="VCC" />
    <net name="GND" />
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="330" footprint="0603" pcbX={0} pcbY={0} schX={0} schY={0} />
    <led name="LED1" footprint="0603" pcbX={12} pcbY={0} schX={6} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)
`

/** Passes the static filter (no `while (true)`, no `for (;;)`) and must die on the wall clock. */
const SLOW_LOOP = `
let n = 0
export default () => {
  for (let i = 0; i < 1e12; i += 1) n += i
  return <board width="10mm" height="10mm" />
}
`

const BANNED_LOOP = `
export default () => {
  while (true) {}
}
`

const NETWORK = `
import fs from "node:fs"
export default () => <board width="10mm" height="10mm" />
`

const MEMORY_HOG = `
const blocks: unknown[] = []
export default () => {
  for (let i = 0; i < 1e9; i += 1) blocks.push(new Array(1e5).fill(i))
  return <board width="10mm" height="10mm" />
}
`

async function main() {
  const started = Date.now()
  const result = await runInSandbox(GOOD, { timeoutMs: 30_000, memoryMb: 512, maxElements: 60_000 })
  console.log(
    `### 1. valid module: ${result.circuitJson.length} elements, ${result.checks.length} checks in ${Date.now() - started}ms`,
  )

  const loopStart = Date.now()
  try {
    await runInSandbox(SLOW_LOOP, { timeoutMs: 4_000, memoryMb: 256, maxElements: 60_000 })
    console.log('### 2. slow loop: NOT CAUGHT (bug)')
  } catch (error) {
    const appError = error as AppError
    console.log(
      `### 2. slow loop: wall clock stopped it in ${Date.now() - loopStart}ms — ${appError.code}: ${appError.internal ?? appError.message}`,
    )
  }

  try {
    assertSafeGeneratedCode(BANNED_LOOP)
    console.log('### 3. `while (true)`: NOT REJECTED (bug)')
  } catch (error) {
    const appError = error as AppError
    console.log(`### 3. \`while (true)\`: ${appError.internal}`)
  }

  for (const [label, source] of [
    ['4. network/fs import', NETWORK],
    ['5. memory hog', MEMORY_HOG],
  ] as const) {
    const t0 = Date.now()
    try {
      if (label.includes('memory')) {
        await runInSandbox(source, { timeoutMs: 15_000, memoryMb: 128, maxElements: 60_000 })
        console.log(`### ${label}: completed (no cap hit) in ${Date.now() - t0}ms`)
      } else {
        assertSafeGeneratedCode(source)
        console.log(`### ${label}: NOT REJECTED (bug)`)
      }
    } catch (error) {
      const appError = error as AppError
      console.log(
        `### ${label}: rejected in ${Date.now() - t0}ms — ${appError.code}: ${appError.internal ?? appError.message}`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
