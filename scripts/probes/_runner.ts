// Shared helper for the Phase 0 probe scripts.
import { runTscircuitCode } from '@tscircuit/eval'
import { runAllChecks } from '@tscircuit/checks'

export async function compileAndReport(label: string, code: string) {
  const started = Date.now()
  try {
    const circuitJson = await runTscircuitCode(code)
    const checks = await runAllChecks(circuitJson as never)
    const errors = [
      ...circuitJson.filter((e) => String(e.type).endsWith('_error')),
      ...checks.filter((c) => String(c.type).endsWith('_error') || String(c.type).endsWith('error')),
    ]
    const pcbTraces = circuitJson.filter((e) => e.type === 'pcb_trace').length
    console.log(
      `### ${label} (${Date.now() - started}ms): elements=${circuitJson.length} pcb_traces=${pcbTraces} errors=${errors.length}`,
    )
    for (const e of errors.slice(0, 8)) {
      const record = e as { type?: string; message?: string }
      console.log(`   - ${record.type} | ${String(record.message).slice(0, 170)}`)
    }
    return { circuitJson, checks, errors }
  } catch (error) {
    console.log(`### ${label}: THREW ${String((error as Error).message).slice(0, 300)}`)
    return null
  }
}
