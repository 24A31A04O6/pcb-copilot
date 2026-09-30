#!/usr/bin/env node
/**
 * fireworks-eval.mjs — tiny, zero-dependency model comparison harness for pcb-copilot.
 *
 * Compares two Fireworks chat models on the two jobs this app actually does
 * (JSON-schema design briefs + tscircuit TSX codegen) plus edge cases, then
 * prints a quality-vs-price report.
 *
 * TOKEN BUDGET (hard cap — the run aborts before exceeding it):
 *   default 50,000 tokens total (prompt+completion across ALL calls). The full
 *   suite typically uses ~10-15k. Set a lower cap with --budget=N.
 *
 * Usage:
 *   FIREWORKS_API_KEY=fw_... node scripts/fireworks-eval.mjs
 *   node scripts/fireworks-eval.mjs --budget=20000
 *   node scripts/fireworks-eval.mjs --model-a=accounts/fireworks/models/deepseek-v4-flash \
 *       --model-b=accounts/fireworks/models/deepseek-v4-pro
 *   node scripts/fireworks-eval.mjs --mock        # self-test the harness, no network
 *
 * The key is read from $FIREWORKS_API_KEY or .env.local (never hard-coded,
 * never committed).
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  API_URL,
  CASES,
  jsonSchemaFor,
  messagesFor,
  postprocess,
  priceFor,
} from './fireworks-eval-suite.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = Object.fromEntries(
  process.argv.slice(2)
    .map((a) => (a.startsWith('--') ? a.slice(2).split('=') : null))
    .filter(Boolean)
    .map(([k, v]) => [k, v ?? 'true']),
)

const MODEL_A = args['model-a'] ?? 'accounts/fireworks/models/deepseek-v4-flash'
const MODEL_B = args['model-b'] ?? 'accounts/fireworks/models/deepseek-v4-pro'
const BUDGET = Number(args.budget ?? 50_000)
const MOCK = args.mock === 'true'

function readSecret(name) {
  if (process.env[name]) return process.env[name].trim()
  try {
    for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i > 0 && t.slice(0, i).trim() === name) return t.slice(i + 1).trim()
    }
  } catch { /* no .env.local */ }
  return ''
}

// --- mock transport (harness self-test, zero tokens) ----------------------
function mockComplete(model, messages, isBrief) {
  const user = messages.at(-1).content
  if (isBrief && user.includes('make me a board')) {
    return {
      content: '{"status":"needs_clarification","questions":["Supply voltage?"],"summary":"Vague request","assumptions":[],"requirements":[]}',
      usage: { prompt_tokens: 120, completion_tokens: 60 },
    }
  }
  if (isBrief) {
    return {
      content: `{"status":"ready","questions":[],"summary":"Mock brief","assumptions":["a"],"requirements":["r"]}`,
      usage: { prompt_tokens: 110, completion_tokens: 55 },
    }
  }
  if (user.includes('10A')) {
    return {
      content:
        'export default () => (\n  <board width="20mm" height="20mm">\n    <resistor name="R1" resistance="0.001" footprint="2512" pcbX={2} pcbY={2} schX={1} schY={1} />\n  </board>\n)',
      usage: { prompt_tokens: 200, completion_tokens: 80 },
    }
  }
  return {
    content:
      'export default () => (\n  <board width="30mm" height="20mm">\n    <resistor name="R1" resistance="330" footprint="0603" pcbX={4} pcbY={2} schX={1} schY={1} />\n    <led name="LED1" color="red" footprint="0603" pcbX={8} pcbY={2} schX={4} schY={1} />\n    <trace from=".R1 .pin2" to=".LED1 .pos" />\n    <trace from=".R1 .pin1" to="net.VCC" />\n    <trace from=".LED1 .neg" to="net.GND" />\n  </board>\n)',
    usage: { prompt_tokens: 210, completion_tokens: 95 },
  }
}

async function callModel(apiKey, model, messages, opts) {
  const body = {
    model,
    max_tokens: opts.maxTokens,
    temperature: 0.2,
    top_p: 0.9,
    messages,
    ...(opts.jsonSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'pcb_design_brief', schema: opts.jsonSchema },
          },
        }
      : {}),
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error?.message ?? `HTTP ${res.status}`)
  const msg = payload?.choices?.[0]?.message ?? {}
  const content =
    (typeof msg.content === 'string' ? msg.content : '') || msg.reasoning_content || ''
  return {
    content: content.trim(),
    usage: payload?.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  }
}

function fmtRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join('  ')
}

async function runSuite() {
  const apiKey = MOCK ? 'mock' : readSecret('FIREWORKS_API_KEY')
  if (!apiKey) {
    console.error('Missing FIREWORKS_API_KEY (env or .env.local). Aborting — no tokens spent.')
    process.exit(1)
  }

  const models = [
    { id: MODEL_A, label: 'A', price: priceFor(MODEL_A), usedIn: 0, usedOut: 0, results: [] },
    { id: MODEL_B, label: 'B', price: priceFor(MODEL_B), usedIn: 0, usedOut: 0, results: [] },
  ]

  console.log(`\npcb-copilot · Fireworks model eval${MOCK ? ' (MOCK — harness self-test)' : ''}`)
  console.log(`  A = ${MODEL_A}`)
  console.log(`  B = ${MODEL_B}`)
  console.log(`  hard token budget: ${BUDGET.toLocaleString()} (aborts before exceeding)\n`)

  let spent = 0
  outer: for (const model of models) {
    for (const c of CASES) {
      const projected = spent + c.maxTokens + 600
      if (projected > BUDGET) {
        console.log(`  [budget] stopping before ${c.id} on model ${model.label} (would exceed ${BUDGET})`)
        break outer
      }

      const t0 = Date.now()
      let resp
      try {
        resp = MOCK
          ? mockComplete(model.id, messagesFor(c), c.kind === 'brief')
          : await callModel(apiKey, model.id, messagesFor(c), {
              maxTokens: c.maxTokens,
              jsonSchema: jsonSchemaFor(c),
            })
      } catch (err) {
        model.results.push({
          caseId: c.id,
          error: String(err.message ?? err),
          checks: [['call succeeded', false]],
        })
        console.log(`  [error] ${model.label} ${c.id}: ${err.message ?? err}`)
        continue
      }
      const ms = Date.now() - t0
      spent += (resp.usage.prompt_tokens ?? 0) + (resp.usage.completion_tokens ?? 0)
      model.usedIn += resp.usage.prompt_tokens ?? 0
      model.usedOut += resp.usage.completion_tokens ?? 0

      const r = postprocess(c.kind, resp.content)
      const checks = c.expect(r)
      model.results.push({ caseId: c.id, checks, ms, usage: resp.usage })
      const passed = checks.filter(([, ok]) => ok).length
      console.log(
        `  ${model.label} ${c.id.padEnd(20)} ${passed}/${checks.length} checks  ${String(ms).padStart(5)}ms  ${resp.usage.prompt_tokens}+${resp.usage.completion_tokens} tok`,
      )
      await new Promise((res) => setTimeout(res, 250))
    }
  }

  console.log('\n=== PER-CASE DETAIL ===')
  for (const c of CASES) {
    console.log(`\n${c.id} (${c.kind})`)
    for (const model of models) {
      const res = model.results.find((x) => x.caseId === c.id)
      if (!res) {
        console.log(`  ${model.label}: (not run — budget)`)
        continue
      }
      if (res.error) {
        console.log(`  ${model.label}: ERROR ${res.error}`)
        continue
      }
      for (const [name, ok] of res.checks) console.log(`  ${model.label}: ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    }
  }

  console.log('\n=== SUMMARY (quality over price) ===')
  const rows = []
  for (const model of models) {
    const all = model.results.flatMap((r) => r.checks)
    const passed = all.filter(([, ok]) => ok).length
    const cost = (model.usedIn / 1e6) * model.price.input + (model.usedOut / 1e6) * model.price.output
    rows.push({
      model: model.id.split('/').pop(),
      price: model.price,
      passed,
      total: all.length,
      pct: all.length ? Math.round((passed / all.length) * 100) : 0,
      inTok: model.usedIn,
      outTok: model.usedOut,
      cost,
    })
  }
  const widths = [22, 10, 10, 10, 10, 12]
  console.log(fmtRow(['model', 'checks', 'score%', 'in tok', 'out tok', 'cost USD'], widths))
  for (const r of rows) {
    console.log(
      fmtRow([r.model, `${r.passed}/${r.total}`, `${r.pct}%`, r.inTok, r.outTok, `$${r.cost.toFixed(5)}`], widths),
    )
  }
  console.log(`\ntotal tokens spent this run: ${spent.toLocaleString()} / budget ${BUDGET.toLocaleString()}`)

  console.log('\nest. cost per full app run (brief + codegen + 1 repair ≈ 3.9k in / 3.7k out):')
  for (const r of rows) {
    const est = (3900 / 1e6) * r.price.input + (3700 / 1e6) * r.price.output
    console.log(`  ${r.model}: ~$${est.toFixed(5)} per board request`)
  }

  const [a, b] = rows
  if (a && b) {
    const better = a.pct >= b.pct ? a : b
    const other = better === a ? b : a
    const cheaper = a.cost <= b.cost ? a : b
    console.log('\nverdict:')
    console.log(`  higher quality score: ${better.model} (${better.pct}% vs ${other.pct}%)`)
    console.log(`  cheaper this run:     ${cheaper.model}`)
    if (better.pct === other.pct) {
      console.log('  scores tied — pick the cheaper model unless the failing checks matter to you.')
    }
  }
  console.log('')
}

runSuite().catch((e) => {
  console.error('harness failure (no further tokens will be spent):', e)
  process.exit(1)
})
