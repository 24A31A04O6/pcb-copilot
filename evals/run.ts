/**
 * The eval runner.
 *
 *   pnpm run eval                    run everything that can run without a key
 *   pnpm run eval -- --model         also run the model cases (needs FIREWORKS_API_KEY)
 *   pnpm run eval -- --compare       run each model case against both models and write
 *                                    docs/MODEL-COMPARISON.md
 *   pnpm run eval -- --budget=60000  hard cap on total tokens; stops before it overspends
 *   pnpm run eval -- --only=a,b,c    run a named subset of the model cases
 *
 * The key is read from `.env.local`, which is how the app reads it too, so the same secret
 * serves both without being exported into a shell history.
 *
 * Nothing here is mocked. An offline case compiles in the real sandbox and is scored by
 * the real check engine; a model case runs the real pipeline against Fireworks. A case
 * that cannot run is reported as `skipped` with the reason, never as a pass -- an eval
 * suite that reports success for work it did not do is worse than no suite at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { evaluateDesign } from '@/lib/checks'
import { extractTsx, runPipeline } from '@/lib/server/pipeline'
import { assertSafeGeneratedCode, runInSandbox } from '@/lib/server/compile/sandbox'
import { knowledgeFor } from '@/lib/server/knowledge'
import { circuitJsonHash } from '@/lib/goldens/run'
import { DEFAULT_FAB_PRESET_ID } from '@/lib/server/checks/fab-presets'
import { getServerConfig, shortModelName } from '@/lib/server/env'

import { EVAL_CASES, type EvalCase } from './cases'

type Outcome = 'pass' | 'fail' | 'skipped'

type CaseResult = {
  id: string
  kind: EvalCase['kind']
  title: string
  intent: string
  brief: string
  outcome: Outcome
  /** Per-assertion detail, so a failure names the assertion that broke. */
  checks: { assertion: string; ok: boolean; detail: string }[]
  metrics: Record<string, number | string | boolean | null>
  error: string | null
  durationMs: number
}

const args = new Set(process.argv.slice(2))
const wantModel = args.has('--model') || args.has('--compare')
const wantCompare = args.has('--compare')

/**
 * Hard token budget.
 *
 * The eval corpus is not free and the worst case is not obvious: a model case is a brief
 * call plus a codegen call plus up to three repair calls, against *two* models in
 * `--compare` mode, and codegen alone runs to several thousand output tokens. A run started
 * without thinking about it can spend an order of magnitude more than expected.
 *
 * So the budget is a circuit breaker, not an estimate. `BUDGET.spent` only grows after a
 * call has actually returned; `assertBudget` is checked before each one. The overrun check
 * uses the *default* token ceiling, so a case that will be refused is caught before it is
 * paid for rather than after.
 *
 * Default is deliberately small. `pnpm run eval -- --compare` is a scheduled job, not a
 * thing to run on every deploy.
 */
const DEFAULT_BUDGET_TOKENS = 120_000
const MAX_CODEGEN_OUTPUT_TOKENS = 8_000

function readBudgetTokens(): number {
  const flag = process.argv.find((a) => a.startsWith('--budget='))
  const raw = flag ? flag.slice('--budget='.length) : null
  if (raw === null) return DEFAULT_BUDGET_TOKENS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`--budget must be a positive number of tokens, got ${raw}`)
    process.exit(2)
  }
  return Math.floor(parsed)
}

const BUDGET = { limit: readBudgetTokens(), spent: 0, stopped: false, calls: 0 }

/**
 * `--only=a,b,c` runs a named subset. The full 16-case corpus against two models is not a
 * thing to do on a whim; a quality question is usually answerable from a handful.
 */
function selectedModelCases() {
  const flag = process.argv.find((a) => a.startsWith('--only='))
  if (!flag) return EVAL_CASES.filter((c) => c.kind === 'model')
  const wanted = new Set(flag.slice('--only='.length).split(',').map((v) => v.trim()).filter(Boolean))
  const chosen = EVAL_CASES.filter((c) => c.kind === 'model' && wanted.has(c.id))
  if (chosen.length === 0) {
    console.error(
      `--only matched no model cases. Available:\n  ${EVAL_CASES.filter((c) => c.kind === 'model')
        .map((c) => c.id)
        .join('\n  ')}`,
    )
    process.exit(2)
  }
  return chosen
}

function assertBudget(what: string): void {
  if (BUDGET.stopped) {
    throw new Error(
      `token budget exhausted: ${BUDGET.spent.toLocaleString()} of ${BUDGET.limit.toLocaleString()} used`,
    )
  }
  if (BUDGET.spent + MAX_CODEGEN_OUTPUT_TOKENS > BUDGET.limit) {
    BUDGET.stopped = true
    throw new Error(
      `token budget: ${BUDGET.spent.toLocaleString()} used, next case (${what}) could take up to ` +
        `${MAX_CODEGEN_OUTPUT_TOKENS.toLocaleString()} more, limit is ${BUDGET.limit.toLocaleString()}. ` +
        `Stopped before spending it. Re-run with --budget=<n> to continue.`,
    )
  }
}

function recordSpend(usage: { input: number; output: number }): void {
  BUDGET.spent += usage.input + usage.output
  BUDGET.calls += 1
  if (BUDGET.spent > BUDGET.limit) BUDGET.stopped = true
}

const results: CaseResult[] = []
const started = Date.now()

function record(result: CaseResult): CaseResult {
  results.push(result)
  const mark = result.outcome === 'pass' ? 'ok  ' : result.outcome === 'fail' ? 'FAIL' : 'skip'
  console.log(
    `${mark} ${result.id.padEnd(34)} ${result.outcome === 'skipped' ? result.error ?? '' : `${result.checks.filter((c) => c.ok).length}/${result.checks.length}`}`,
  )
  for (const check of result.checks) {
    if (!check.ok) console.log(`       - ${check.assertion}: ${check.detail}`)
  }
  if (result.error && result.outcome === 'fail') console.log(`       ! ${result.error}`)
  return result
}

// ---------------------------------------------------------------------------
// offline cases
// ---------------------------------------------------------------------------

function value(assertion: string): string | null {
  const index = assertion.indexOf(':')
  return index === -1 ? null : assertion.slice(index + 1)
}

function judge(
  evalCase: EvalCase,
  checks: CaseResult['checks'],
  metrics: CaseResult['metrics'],
  error: string | null = null,
): void {
  const failed = checks.filter((c) => !c.ok)
  record({
    id: evalCase.id,
    kind: evalCase.kind,
    title: evalCase.title,
    intent: evalCase.intent,
    brief: evalCase.brief,
    outcome: failed.length === 0 && !error ? 'pass' : 'fail',
    checks,
    metrics,
    error,
    durationMs: 0,
  })
}

async function runOffline(evalCase: EvalCase): Promise<void> {
  const caseStart = Date.now()
  const checks: CaseResult['checks'] = []
  const metrics: CaseResult['metrics'] = {}

  const needsRetrieval = evalCase.assertions.some((a) => a.startsWith('retrieves'))
  if (needsRetrieval) {
    const hits = knowledgeFor(evalCase.brief, 5)
    metrics['retrieval.top'] = hits[0]?.topic ?? null
    metrics['retrieval.count'] = hits.length
    for (const assertion of evalCase.assertions) {
      if (assertion === 'retrieves-nothing') {
        checks.push({
          assertion,
          ok: hits.length === 0,
          detail: hits.length === 0 ? 'no chunk claimed to know it' : `returned ${hits.map((h) => h.topic).join(', ')}`,
        })
        continue
      }
      if (assertion.startsWith('retrieves-nothing:')) {
        // The corpus is allowed to return weakly related chunks; what it must never do is
        // return a chunk that claims to *define* an identifier that does not exist.
        const identifier = value(assertion)!
        const claimants = hits.filter((hit) => (hit.keywords ?? []).includes(identifier))
        checks.push({
          assertion,
          ok: claimants.length === 0,
          detail: claimants.length === 0 ? `no chunk claims to define ${identifier}` : `${claimants.map((h) => h.id).join(', ')} claims to define it`,
        })
        continue
      }
      if (!assertion.startsWith('retrieves:')) continue
      const topic = value(assertion)!
      const rank = hits.findIndex((hit) => hit.topic === topic)
      checks.push({
        assertion,
        ok: rank >= 0 && rank < 3,
        detail: rank === -1 ? `${topic} was not retrieved` : rank === 0 ? `rank 1: ${hits[0]?.title}` : `rank ${rank + 1}`,
      })
    }
    const took = Date.now() - caseStart
    results.push({
      id: evalCase.id,
      kind: 'offline',
      title: evalCase.title,
      intent: evalCase.intent,
      brief: evalCase.brief,
      outcome: checks.every((c) => c.ok) ? 'pass' : 'fail',
      checks,
      metrics,
      error: null,
      durationMs: took,
    })
    console.log(`${checks.every((c) => c.ok) ? 'ok  ' : 'FAIL'} ${evalCase.id.padEnd(34)} top=${metrics['retrieval.top']}`)
    return
  }

  const reference = evalCase.reference
  if (reference === undefined) {
    judge(evalCase, [{ assertion: 'reference', ok: false, detail: 'offline case has no reference source' }], metrics)
    return
  }

  for (const assertion of evalCase.assertions) {
    if (assertion === 'extracts-tsx') {
      const extracted = extractTsx(reference)
      checks.push({
        assertion,
        ok: extractTsx(extracted) === extracted && extracted.startsWith('export default'),
        detail: extracted.split('\n')[0]?.slice(0, 60) ?? 'empty',
      })
    }
    if (assertion === 'rejects-code') {
      let rejected = false
      let why = ''
      try {
        assertSafeGeneratedCode(reference)
      } catch (thrown) {
        rejected = true
        why = thrown instanceof Error ? thrown.message.slice(0, 90) : String(thrown)
      }
      checks.push({ assertion, ok: rejected, detail: rejected ? why : 'accepted by the static check' })
    }
  }

  if (evalCase.assertions.every((a) => a === 'extracts-tsx' || a === 'rejects-code')) {
    judge(evalCase, checks, metrics)
    return
  }

  let source = reference
  if (evalCase.assertions.includes('extracts-tsx')) source = extractTsx(reference)

  const compileStart = Date.now()
  let circuitJson: unknown[] = []
  let compileError: string | null = null
  try {
    const sandbox = await runInSandbox(source, {
      timeoutMs: evalCase.timeoutMs ?? 45_000,
      memoryMb: 768,
      maxElements: 20_000,
    })
    circuitJson = sandbox.circuitJson
    metrics['elements'] = circuitJson.length
  } catch (thrown) {
    compileError = thrown instanceof Error ? thrown.message : String(thrown)
  }
  metrics['compileMs'] = Date.now() - compileStart
  metrics['timedOut'] = compileError !== null && /time|exceeded|COMPILE_FAILED/i.test(compileError)

  const compiled = compileError === null
  if (evalCase.expectCompileFailure) {
    checks.push({
      assertion: 'compiles',
      ok: !compiled,
      detail: compiled ? 'compiled, but the wall clock should have stopped it' : `stopped after ${metrics['compileMs']}ms`,
    })
    judge(evalCase, checks, metrics, compiled ? 'the runaway design was not stopped' : null)
    return
  }

  checks.push({
    assertion: 'compiles',
    ok: compiled,
    detail: compiled ? `${circuitJson.length} elements` : (compileError ?? '').slice(0, 140),
  })
  if (!compiled) {
    judge(evalCase, checks, metrics, compileError)
    return
  }

  const report = evaluateDesign(circuitJson, [], evalCase.fabPresetId ?? DEFAULT_FAB_PRESET_ID)
  const blocking = report.checks.filter((c) => c.severity === 'error')
  const warnings = report.checks.filter((c) => c.severity === 'warning')
  metrics['blocking'] = blocking.length
  metrics['warnings'] = report.warningCount
  metrics['parts'] = report.stats.components
  metrics['routedTraces'] = report.stats.routedTraces
  metrics['layers'] = report.stats.pcbLayers

  const usedElements = new Set<string>()
  for (const element of circuitJson as Record<string, unknown>[]) {
    const type = typeof element.type === 'string' ? element.type : ''
    const match = type.match(/^source_(.+)$/)
    if (match) usedElements.add(match[1])
    if (type === 'pcb_component') usedElements.add('component')
  }

  for (const assertion of evalCase.assertions) {
    switch (assertion.split(':')[0]) {
      case 'verified':
        checks.push({
          assertion,
          ok: report.passed,
          detail: report.passed ? 'no blocking checks' : blocking.slice(0, 3).map((c) => c.code).join(', '),
        })
        break
      case 'check':
        checks.push({
          assertion,
          ok: blocking.some((c) => c.code === value(assertion)),
          detail: blocking.some((c) => c.code === value(assertion)) ? 'raised' : `raised instead: ${blocking.map((c) => c.code).join(', ') || 'nothing'}`,
        })
        break
      case 'no-check':
        checks.push({
          assertion,
          ok: !blocking.some((c) => c.code === value(assertion)),
          detail: blocking.some((c) => c.code === value(assertion)) ? 'raised' : 'absent',
        })
        break
      case 'warn':
        checks.push({
          assertion,
          ok: warnings.some((c) => c.code === value(assertion)),
          detail: warnings.some((c) => c.code === value(assertion)) ? 'raised' : `raised instead: ${warnings.map((c) => c.code).slice(0, 4).join(', ') || 'nothing'}`,
        })
        break
      case 'no-warn':
        checks.push({
          assertion,
          ok: !warnings.some((c) => c.code === value(assertion)),
          detail: warnings.some((c) => c.code === value(assertion)) ? 'raised' : 'absent',
        })
        break
      case 'min-parts':
        checks.push({
          assertion,
          ok: report.stats.components >= Number(value(assertion)),
          detail: `${report.stats.components} parts`,
        })
        break
      case 'min-traces':
        checks.push({
          assertion,
          ok: report.stats.routedTraces >= Number(value(assertion)),
          detail: `${report.stats.routedTraces} routed traces`,
        })
        break
      case 'layers':
        checks.push({
          assertion,
          ok: report.stats.pcbLayers === Number(value(assertion)),
          detail: `${report.stats.pcbLayers} layers`,
        })
        break
      case 'uses':
        checks.push({
          assertion,
          ok: usedElements.has(value(assertion)!) || source.includes(`<${value(assertion)}`),
          detail: usedElements.has(value(assertion)!) ? 'present in Circuit JSON' : `not in Circuit JSON (${[...usedElements].slice(0, 6).join(', ')})`,
        })
        break
      case 'deterministic': {
        const again = await runInSandbox(source, { timeoutMs: 45_000, memoryMb: 768, maxElements: 20_000 })
        const first = circuitJsonHash(circuitJson)
        const second = circuitJsonHash(again.circuitJson)
        checks.push({ assertion, ok: first === second, detail: first === second ? first.slice(0, 12) : `${first.slice(0, 8)} != ${second.slice(0, 8)}` })
        break
      }
      default:
        break
    }
  }

  judge(evalCase, checks, metrics)
}

// ---------------------------------------------------------------------------
// model cases
// ---------------------------------------------------------------------------

/** USD per million tokens, as published on 2026-09-29. See docs/RESEARCH.md. */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'glm-5p3-flash': { input: 0.40, output: 1.60 },
  'deepseek-v4p1-flash': { input: 0.14, output: 0.28 },
}
const FALLBACK_PRICE = { input: 0.40, output: 1.60 }

function estimateCost(model: string, usage: { input: number; output: number }): number {
  const price = PRICES_PER_MTOK[shortModelName(model)] ?? FALLBACK_PRICE
  return (usage.input / 1e6) * price.input + (usage.output / 1e6) * price.output
}

async function runModel(evalCase: EvalCase, modelOverride?: string): Promise<CaseResult> {
  const caseStart = Date.now()
  const checks: CaseResult['checks'] = []
  const metrics: CaseResult['metrics'] = {}
  const config = getServerConfig()
  if (modelOverride) config.model = modelOverride

  let result: Awaited<ReturnType<typeof runPipeline>> | null = null
  let error: string | null = null
  try {
    result = await runPipeline(config, {
      brief: evalCase.brief,
      boardColorId: 'jade' in {} ? 'jade' : 'default',
      fabPresetId: evalCase.fabPresetId ?? DEFAULT_FAB_PRESET_ID,
      requestId: `eval-${evalCase.id}`,
      onEvent: () => {},
      onLog: () => {},
    })
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  }

  metrics['model'] = shortModelName(config.model)
  metrics['error'] = error
  metrics['costUsd'] = result ? Number(estimateCost(config.model, result.tokenUsage).toFixed(6)) : null
  metrics['inputTokens'] = result?.tokenUsage.input ?? null
  metrics['outputTokens'] = result?.tokenUsage.output ?? null
  metrics['repairs'] = result?.repairCount ?? null
  if (result) recordSpend(result.tokenUsage)

  for (const assertion of evalCase.assertions) {
    switch (assertion.split(':')[0]) {
      case 'valid-brief':
        checks.push({
          assertion,
          ok: result !== null,
          detail: result ? `${result.title}` : (error ?? 'no result').slice(0, 140),
        })
        break
      case 'valid-tsx':
        checks.push({
          assertion,
          ok: result !== null && extractTsx(result.tsx).startsWith('export default'),
          detail: result ? result.tsx.split('\n')[0]?.slice(0, 60) ?? '' : 'no result',
        })
        break
      case 'no-fallback':
        checks.push({
          assertion,
          ok: result !== null && !result.fallbackUsed,
          detail: result ? (result.fallbackUsed ? 'fell back' : 'primary model served it') : 'no result',
        })
        break
      default: {
        if (!result) {
          checks.push({ assertion, ok: false, detail: 'no result to assert against' })
          break
        }
        const blocking = result.checks.filter((c) => c.severity === 'error')
        switch (assertion.split(':')[0]) {
          case 'compiles':
            checks.push({ assertion, ok: true, detail: `${result.circuitJson.length} elements` })
            break
          case 'verified':
            checks.push({ assertion, ok: result.verified, detail: result.verified ? 'verified' : blocking.map((c) => c.code).join(', ') })
            break
          case 'no-check':
            checks.push({ assertion, ok: !blocking.some((c) => c.code === value(assertion)), detail: blocking.some((c) => c.code === value(assertion)) ? 'raised' : 'absent' })
            break
          case 'check':
            checks.push({ assertion, ok: blocking.some((c) => c.code === value(assertion)), detail: blocking.map((c) => c.code).join(', ') || 'nothing raised' })
            break
          case 'layers':
            checks.push({ assertion, ok: result.stats.pcbLayers === Number(value(assertion)), detail: `${result.stats.pcbLayers} layers` })
            break
          case 'uses':
            checks.push({ assertion, ok: result.tsx.includes(`<${value(assertion)}`), detail: result.tsx.includes(`<${value(assertion)}`) ? 'present' : 'absent' })
            break
          case 'min-parts':
            checks.push({ assertion, ok: result.stats.components >= Number(value(assertion)), detail: `${result.stats.components} parts` })
            break
          case 'min-traces':
            checks.push({ assertion, ok: result.stats.routedTraces >= Number(value(assertion)), detail: `${result.stats.routedTraces} routed traces` })
            break
          default:
            break
        }
      }
    }
  }

  metrics['durationMs'] = Date.now() - caseStart
  const failed = checks.filter((c) => !c.ok)
  return {
    id: evalCase.id,
    kind: 'model',
    title: evalCase.title,
    intent: evalCase.intent,
    brief: evalCase.brief,
    outcome: failed.length === 0 && !error ? 'pass' : 'fail',
    checks,
    metrics,
    error,
    durationMs: Date.now() - caseStart,
  }
}

async function runModelSuite(label: string, model?: string): Promise<CaseResult[]> {
  const suite: CaseResult[] = []
  for (const evalCase of selectedModelCases()) {
    // The circuit breaker. A budget stop is recorded as a skip with the reason, never as a
    // fail: a case that was never run has no opinion about the model, and counting it as a
    // failure would quietly make one model look worse than the other.
    try {
      assertBudget(evalCase.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      suite.push(
        record({
          id: `${label}/${evalCase.id}`,
          kind: 'model',
          title: evalCase.title,
          intent: evalCase.intent,
          brief: evalCase.brief,
          outcome: 'skipped',
          checks: [],
          metrics: {},
          error: message,
          durationMs: 0,
        }),
      )
      continue
    }
    const result = await runModel(evalCase, model)
    result.id = `${label}/${evalCase.id}`
    suite.push(result)
    record(result)
  }
  return suite
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function summarise(): {
  total: number
  passed: number
  failed: number
  skipped: number
  byKind: Record<string, { pass: number; fail: number; skip: number }>
  totalCostUsd: number
  medianCompileMs: number
} {
  const byKind: Record<string, { pass: number; fail: number; skip: number }> = {}
  let passed = 0
  let failed = 0
  let skipped = 0
  let totalCostUsd = 0
  const compileTimes: number[] = []
  for (const result of results) {
    const bucket = (byKind[result.kind] ??= { pass: 0, fail: 0, skip: 0 })
    bucket[result.outcome === 'pass' ? 'pass' : result.outcome === 'fail' ? 'fail' : 'skip'] += 1
    if (result.outcome === 'pass') passed += 1
    else if (result.outcome === 'fail') failed += 1
    else skipped += 1
    if (typeof result.metrics['costUsd'] === 'number') totalCostUsd += result.metrics['costUsd']
    if (typeof result.metrics['compileMs'] === 'number') compileTimes.push(result.metrics['compileMs'])
  }
  compileTimes.sort((a, b) => a - b)
  return {
    total: results.length,
    passed,
    failed,
    skipped,
    byKind,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    medianCompileMs: compileTimes.length ? compileTimes[Math.floor(compileTimes.length / 2)] : 0,
  }
}

function writeReport(): void {
  const summary = summarise()
  mkdirSync(join(process.cwd(), 'evals', 'results'), { recursive: true })
  writeFileSync(
    join(process.cwd(), 'evals', 'results', 'latest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        modelCasesRun: wantModel,
        comparisonRun: wantCompare,
        summary,
        results,
      },
      null,
      2,
    ) + '\n',
  )

  const modelRan = results.some((r) => r.kind === 'model' && r.outcome !== 'skipped')
  const lines: string[] = [
    '# Model and design eval report',
    '',
    `Generated by \`pnpm run eval\` on ${new Date().toISOString().slice(0, 10)}.`,
    'Every number below came from a run; nothing here is estimated unless it says so.',
    '',
    '## Summary',
    '',
    `- **${summary.total}** evals: **${summary.passed}** passed, **${summary.failed}** failed, **${summary.skipped}** skipped`,
    `- Offline (compiler, checks, retrieval): ${summary.byKind.offline?.pass ?? 0} passed, ${summary.byKind.offline?.fail ?? 0} failed`,
    modelRan
      ? `- Model (live Fireworks): ${summary.byKind.model?.pass ?? 0} passed, ${summary.byKind.model?.fail ?? 0} failed`
      : '- Model cases: **not run** — this invocation did not include `--model`, or `FIREWORKS_API_KEY` is absent',
    `- Median compile time: ${summary.medianCompileMs} ms`,
    summary.totalCostUsd > 0 ? `- Total model spend: $${summary.totalCostUsd} at published rates` : '- Model spend: $0 (no model calls)',
    `- Token budget: ${BUDGET.spent.toLocaleString()} of ${BUDGET.limit.toLocaleString()} used${BUDGET.stopped ? ' — **stopped early, remaining cases skipped**' : ''}`,
    '',
    '## Cases',
    '',
    '| Eval | Kind | Outcome | Notes |',
    '| --- | --- | --- | --- |',
  ]
  for (const result of results) {
    const notes =
      result.outcome === 'skipped'
        ? (result.error ?? '')
        : Object.entries(result.metrics)
            .filter(([key]) => !key.startsWith('retrieval.'))
            .map(([key, v]) => `${key}=${v}`)
            .slice(0, 4)
            .join(' ')
    lines.push(`| ${result.id} | ${result.kind} | ${result.outcome} | ${notes} |`)
  }
  lines.push(
    '',
    '## Reading this report',
    '',
    '- An offline case that fails is a regression in this repository: retrieval, the safety',
    '  check, the sandbox, or the check engine. Fix the code, not the expectation.',
    '- A model case that fails is a prompt, model or budget problem. Re-run before changing',
    '  anything; model output moves.',
    '- `skipped` is not `pass`. A suite that reports success for work it did not do is worse',
    '  than no suite at all.',
    '',
  )
  mkdirSync(join(process.cwd(), 'docs'), { recursive: true })
  writeFileSync(join(process.cwd(), 'docs', 'EVALS.md'), lines.join('\n'))
  console.log(`\nwrote evals/results/latest.json and docs/EVALS.md`)
}

function writeComparison(primary: CaseResult[], secondary: CaseResult[]): void {
  const byId = new Map(secondary.map((r) => [r.id.split('/')[1], r]))
  const lines: string[] = [
    '# Model comparison',
    '',
    'Same briefs, same prompts, same compiler, two models. Generated by `pnpm run eval -- --compare`.',
    '',
    `Run on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    '| Brief | Primary | | Fallback | | Primary cost | Fallback cost |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  let primaryWins = 0
  let fallbackWins = 0
  let ties = 0
  let primaryCost = 0
  let fallbackCost = 0
  for (const result of primary) {
    const key = result.id.split('/')[1]
    const other = byId.get(key)
    if (!other) continue
    const pc = typeof result.metrics['costUsd'] === 'number' ? result.metrics['costUsd'] : 0
    const fc = typeof other.metrics['costUsd'] === 'number' ? other.metrics['costUsd'] : 0
    primaryCost += pc
    fallbackCost += fc
    if (result.outcome === 'pass' && other.outcome === 'pass') ties += 1
    else if (result.outcome === 'pass') primaryWins += 1
    else if (other.outcome === 'pass') fallbackWins += 1
    if (result.outcome === 'pass' || other.outcome === 'pass') {
      lines.push(
        `| ${key} | ${result.outcome} | ${result.checks.filter((c) => !c.ok).length} failed | ` +
          `${other.outcome} | ${other.checks.filter((c) => !c.ok).length} failed | $${pc.toFixed(4)} | $${fc.toFixed(4)} |`,
      )
    }
  }
  lines.push(
    '',
    '## Totals',
    '',
    `- Primary passed ${primaryWins} briefs the fallback did not; the fallback passed ${fallbackWins} the primary did not; ${ties} were equal.`,
    `- Primary spend $${primaryCost.toFixed(4)}; fallback spend $${fallbackCost.toFixed(4)}.`,
    '',
    '## How to use this',
    '',
    'The fallback exists for availability, not quality. It is used only when the primary model',
    'is unreachable or returns something unusable, never because a design merely failed to',
    'parse. If the fallback wins on quality, the primary default is the thing to change.',
    '',
  )
  writeFileSync(join(process.cwd(), 'docs', 'MODEL-COMPARISON.md'), lines.join('\n'))
  console.log('wrote docs/MODEL-COMPARISON.md')
}

async function main(): Promise<void> {
  const hasKey = Boolean(process.env.FIREWORKS_API_KEY)
  if (wantModel && !hasKey) {
    console.log('FIREWORKS_API_KEY is not set: model cases will be reported as skipped, not passed.\n')
  }

  for (const evalCase of EVAL_CASES.filter((c) => c.kind === 'offline')) {
    await runOffline(evalCase)
  }

  if (wantModel && hasKey) {
    const primary = await runModelSuite('primary')
    if (wantCompare) {
      const config = getServerConfig()
      const fallbackId = process.env.FIREWORKS_FALLBACK_MODEL ?? 'accounts/fireworks/models/deepseek-v4p1-flash'
      if (config.model === fallbackId) {
        console.log(`\nprimary and fallback are both ${fallbackId}; running only once.`)
        writeComparison(primary, primary)
      } else {
        const secondary = await runModelSuite('fallback', fallbackId)
        writeComparison(primary, secondary)
      }
    }
  } else {
    for (const evalCase of EVAL_CASES.filter((c) => c.kind === 'model')) {
      record({
        id: evalCase.id,
        kind: 'model',
        title: evalCase.title,
        intent: evalCase.intent,
        brief: evalCase.brief,
        outcome: 'skipped',
        checks: [],
        metrics: {},
        error: !hasKey ? 'FIREWORKS_API_KEY is not set' : 'run with --model',
        durationMs: 0,
      })
    }
  }

  writeReport()
  const summary = summarise()
  console.log(
    `\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
  if (summary.failed > 0) process.exitCode = 1
}

void main()
