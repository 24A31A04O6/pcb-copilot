/**
 * Recompute the `expected.hash` of every golden design and rewrite designs/golden/designs.ts.
 *
 * Run this after a deliberate tscircuit upgrade, review the diff, and commit it together with
 * the version bump. A hash that changes without a version bump is a regression.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { GOLDEN_DESIGNS } from '../designs/golden/designs'
import { runGolden } from '../lib/goldens/run'

const DESIGNS_FILE = join(process.cwd(), 'designs/golden/designs.ts')

async function main() {
const results = new Map<string, string>()
for (const design of GOLDEN_DESIGNS) {
  const result = await runGolden(design)
  if (!result.ok) {
    console.error(`FAIL ${design.id}: ${result.error}`)
    process.exitCode = 1
    continue
  }
  results.set(design.id, result.hash)
  const report = result.report!
  const status = report.passed ? 'pass' : `BLOCKED(${report.blockingCount})`
  // `minTraces` is a lower bound on routed PCB traces, which is not the same as the number
  // of <trace> elements: two ports already on the same net need no copper. Report both so a
  // stale expectation is visible rather than silently failing later in CI.
  const drift =
    report.stats.routedTraces < design.expected.minTraces ||
    report.stats.components < design.expected.minComponents
      ? `  <- expected >${design.expected.minComponents} parts / >${design.expected.minTraces} traces`
      : ''
  console.log(
    `${design.id.padEnd(28)} ${status.padEnd(12)} ` +
      `${String(report.stats.components).padStart(2)} parts  ` +
      `${String(report.stats.routedTraces).padStart(2)} routed  ` +
      `${(result.durationMs / 1000).toFixed(1)}s${drift}`,
  )
}

if (process.exitCode === 1) process.exit(1)

const source = await readFile(DESIGNS_FILE, 'utf8')
let updated = source
for (const [id, hash] of results) {
  const pattern = new RegExp(`(id: '${id}',[\\s\\S]*?hash: ')[0-9a-f]*(')`)
  if (!pattern.test(updated)) {
    console.error(`could not locate the hash for ${id}`)
    process.exit(1)
  }
  updated = updated.replace(pattern, `$1${hash}$2`)
}
await writeFile(DESIGNS_FILE, updated)
console.log(`\nrewrote ${results.size} hashes in designs/golden/designs.ts`)
}

void main()
