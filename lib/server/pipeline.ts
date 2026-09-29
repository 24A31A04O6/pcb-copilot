import '@/lib/server/only'

import { createHash } from 'node:crypto'

import { getBoardColor, type BoardColor } from '@/lib/board-colors'
import { evaluateDesign, type CheckReport } from '@/lib/checks'
import type { DesignResult, PipelineEvent, PipelineEventWithoutId, PipelineStage } from '@/lib/design'
import { AppError, toAppError } from '@/lib/errors'
import { extractJsonObject } from '@/lib/llm/json'
import { BRIEF_SCHEMA_NAME, BRIEF_JSON_SCHEMA, briefSchema, briefToPrompt, clampBrief, type DesignBrief } from '@/lib/schemas/brief'

import { runInSandbox } from './compile/sandbox'
import type { ServerConfig } from './env'
import { callModel, callModelWithTools } from './llm/client'
import { PART_SEARCH_TOOL, PART_SEARCH_TOOL_NAME, isPartSearchEnabled, partSearchNotice, searchParts } from './parts'
import { BRIEF_SYSTEM_PROMPT, CODEGEN_SYSTEM_PROMPT, REPAIR_SYSTEM_PROMPT, briefUserPrompt, codegenUserPrompt, repairUserPrompt } from './llm/prompts'
import { knowledgeContext } from './knowledge'
import { TSCIRCUIT_VERSIONS } from './versions'

const MAX_REPAIRS = 3
const CODEGEN_MAX_TOKENS_FLOOR = 4_000

export type RunOptions = {
  brief: string
  revisionNote?: string
  boardColorId: string
  fabPresetId: string
  signal?: AbortSignal
  requestId: string
  /** Deterministic cache hit. */
  cache?: Map<string, DesignResult>
  onEvent: (event: PipelineEvent) => void
  onLog: (level: 'info' | 'warn', message: string) => void
}

type PipelineSend = (event: PipelineEventWithoutId) => void

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'design'
}

export function designHash(input: {
  brief: string
  model: string
  fabPresetId: string
  solderMask: string
}): string {
  return createHash('sha256')
    .update(
      [
        input.brief.trim().replace(/\s+/g, ' '),
        input.model,
        TSCIRCUIT_VERSIONS.eval,
        TSCIRCUIT_VERSIONS.checks,
        input.fabPresetId,
        input.solderMask,
      ].join(''),
    )
    .digest('hex')
    .slice(0, 12)
}

/** Pull a tscircuit module out of arbitrary model text. */
export function extractTsx(raw: string): string {
  const fenced = raw.match(/```(?:tsx|ts|jsx|js)?\s*\r?\n([\s\S]*?)```/i)
  let candidate = fenced?.[1] ?? raw

  const start = candidate.indexOf('export default')
  if (start > 0) {
    // Keep leading helper declarations, drop prose before the module. Whether the head is
    // code or chatter is decided by whether its lines *look* like declarations, not by how
    // many of them there are: "Sure! Here is your design." is one short line of prose, and
    // an earlier version of this kept it, which is how a sentence ended up in a module.
    const head = candidate.slice(0, start)
    const kept = head
      .split('\n')
      .filter((line) => line.trim())
      .filter((line) => /^\s*(?:const|let|var|function|class|type|interface|enum|import|export|\/\/|\/\*)/.test(line))
    candidate = kept.length > 0 && kept.length <= 20 ? `${kept.join('\n')}\n` + candidate.slice(start) : candidate.slice(start)
  }
  candidate = candidate.replace(/```\s*$/, '').trim()
  return candidate
}

export async function runPipeline(config: ServerConfig, options: RunOptions): Promise<DesignResult> {
  const started = Date.now()
  const emit = options.onEvent
  let eventId = 0
  const send = (event: PipelineEventWithoutId) => {
    eventId += 1
    emit({ ...event, id: eventId } as PipelineEvent)
  }
  const stage = (name: PipelineStage, label: string, detail?: string) => {
    send({ event: 'stage', data: { stage: name, label, ...(detail ? { detail } : {}) } })
  }
  const log = (level: 'info' | 'warn', message: string) => {
    options.onLog(level, message)
    send({ event: 'log', data: { level, message, at: Date.now() } })
  }

  const boardColor: BoardColor = getBoardColor(options.boardColorId)
  const tokenUsage = { input: 0, output: 0 }

  // ---- cache -----------------------------------------------------------------
  const hash = designHash({
    brief: options.brief,
    model: config.model,
    fabPresetId: options.fabPresetId,
    solderMask: boardColor.mask,
  })
  const cached = options.cache?.get(hash)
  if (cached) {
    log('info', `Cache hit for design ${hash}.`)
    send({ event: 'done', data: { design: { ...cached, designHash: hash } } })
    return { ...cached, designHash: hash }
  }

  try {
    // ---- Stage A: design brief (json_schema, no reasoning) --------------------
    stage('brief', 'Reading the brief')
    const briefResult = await callModel(
      config,
      [
        { role: 'system', content: BRIEF_SYSTEM_PROMPT },
        { role: 'user', content: briefUserPrompt(options.brief, options.revisionNote) },
      ],
      {
        maxTokens: 6_000,
        temperature: 0.2,
        timeoutMs: Math.min(config.timeoutMs, 45_000),
        jsonSchema: { name: BRIEF_SCHEMA_NAME, schema: BRIEF_JSON_SCHEMA },
        signal: options.signal,
        requestId: options.requestId,
        logger: (entry) => log('info', `LLM ${JSON.stringify(entry)}`),
      },
    )
    tokenUsage.input += briefResult.usage.input
    tokenUsage.output += briefResult.usage.output

    const extracted = extractJsonObject(briefResult.content)
    if (!extracted.ok) {
      throw new AppError(
        extracted.reason === 'truncated' ? 'LLM_TRUNCATED' : 'LLM_INVALID_JSON',
        {
          internal: `Stage A extraction failed (${extracted.reason}): ${extracted.detail}. Raw: ${briefResult.content.slice(0, 600)}`,
        },
      )
    }

    const parsedBrief = briefSchema.safeParse(extracted.value)
    if (!parsedBrief.success) {
      // Exactly one repair call, then a typed error.
      const issues = parsedBrief.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      log('warn', `Brief schema mismatch: ${issues.join('; ')}`)
      const repaired = await repairBrief(config, briefResult.content, issues, options.signal, tokenUsage)
      if (!repaired) {
        throw new AppError('LLM_SCHEMA_MISMATCH', { details: issues, internal: briefResult.content.slice(0, 600) })
      }
      return finishWithBrief(config, options, repaired, hash, boardColor, started, send, stage, log, tokenUsage, false)
    }

    const brief = clampBrief(parsedBrief.data)
    return await finishWithBrief(config, options, brief, hash, boardColor, started, send, stage, log, tokenUsage, false)
  } catch (error) {
    throw toAppError(error)
  }
}

async function repairBrief(
  config: ServerConfig,
  badOutput: string,
  issues: string[],
  signal: AbortSignal | undefined,
  tokenUsage: { input: number; output: number },
): Promise<DesignBrief | null> {
  try {
    const repaired = await callModel(
      config,
      [
        { role: 'system', content: BRIEF_SYSTEM_PROMPT },
        { role: 'assistant', content: badOutput.slice(0, 4_000) },
        {
          role: 'user',
          content: [
            'That object was rejected by the schema validator.',
            'Validation errors:',
            ...issues.map((issue) => `- ${issue}`),
            'Return ONLY the corrected JSON object. No prose, no fences.',
          ].join('\n'),
        },
      ],
      {
        maxTokens: 6_000,
        temperature: 0,
        timeoutMs: Math.min(config.timeoutMs, 45_000),
        jsonSchema: { name: BRIEF_SCHEMA_NAME, schema: BRIEF_JSON_SCHEMA },
        signal,
      },
    )
    tokenUsage.input += repaired.usage.input
    tokenUsage.output += repaired.usage.output
    const extracted = extractJsonObject(repaired.content)
    if (!extracted.ok) return null
    const parsed = briefSchema.safeParse(extracted.value)
    return parsed.success ? clampBrief(parsed.data) : null
  } catch {
    return null
  }
}

async function finishWithBrief(
  config: ServerConfig,
  options: RunOptions,
  brief: DesignBrief,
  hash: string,
  boardColor: BoardColor,
  started: number,
  send: PipelineSend,
  stage: (name: PipelineStage, label: string, detail?: string) => void,
  log: (level: 'info' | 'warn', message: string) => void,
  tokenUsage: { input: number; output: number },
  fallbackUsed: boolean,
): Promise<DesignResult> {
  send({ event: 'brief', data: { title: brief.title, summary: brief.summary, brief } })
  stage('codegen', `Writing tscircuit source with ${config.model.split('/').pop()}`)

  let partSearchUsed = false
  let code = await generateCode(
    config,
    brief,
    options.signal,
    log,
    tokenUsage,
    (chunk) => send({ event: 'codegen', data: { chunk, bytes: chunk.length } }),
    (used) => {
      partSearchUsed = used
    },
  )

  let lastReport: CheckReport | null = null
  let repairCount = 0
  const fallback = fallbackUsed

  for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt += 1) {
    stage('compile', attempt === 1 ? 'Compiling' : `Recompiling (pass ${attempt})`, code.length + ' chars')
    send({ event: 'compile', data: { attempt, ok: false } })

    let compiled: { circuitJson: unknown[]; checks: unknown[]; durationMs: number }
    try {
      compiled = await runInSandbox(code, {
        timeoutMs: config.compileTimeoutMs,
        memoryMb: config.compileMemoryMb,
        maxElements: 60_000,
        signal: options.signal,
      })
    } catch (error) {
      const appError = toAppError(error, 'COMPILE_FAILED')
      if (attempt > MAX_REPAIRS) throw appError
      repairCount += 1
      send({
        event: `repair#${repairCount}`,
        data: { iteration: repairCount, reasons: [appError.internal ?? appError.message] },
      })
      code = await repairCode(config, code, [], appError.internal ?? appError.message, options.signal, log, tokenUsage, fallback)
      continue
    }

    send({ event: 'compile', data: { attempt, ok: true, durationMs: compiled.durationMs } })

    stage('checks', 'Running connectivity, placement and fab checks')
    const report = evaluateDesign(compiled.circuitJson, compiled.checks, options.fabPresetId)
    lastReport = report
    send({ event: 'checks', data: { report } })
    log(
      report.passed ? 'info' : 'warn',
      `Pass ${attempt}: ${report.blockingCount} blocking, ${report.warningCount} warnings.`,
    )

    if (report.passed) {
      const design: DesignResult = {
        slug: slugify(brief.title),
        title: brief.title,
        summary: brief.summary,
        tsx: code,
        circuitJson: compiled.circuitJson,
        checks: report.checks,
        stats: report.stats,
        verified: true,
        blockingCount: 0,
        warningCount: report.warningCount,
        iterations: attempt,
        model: config.model,
        fallbackUsed: fallback,
    partSearchUsed,
        fab: {
          presetId: report.fabPresetId,
          label: report.fabPresetLabel,
          solderMask: boardColor.mask,
          silkscreen: boardColor.silk,
        },
        designHash: hash,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        repairCount,
        tokenUsage: { ...tokenUsage },
      }
      options.cache?.set(hash, design)
      stage('done', 'Verified — manufacturing exports unlocked')
      send({ event: 'done', data: { design } })
      return design
    }

    if (attempt > MAX_REPAIRS) break

    repairCount += 1
    const reasons = report.checks
      .filter((check) => check.severity === 'error')
      .slice(0, 12)
      .map((check) => `${check.code}: ${check.message}`)
    send({ event: `repair#${repairCount}`, data: { iteration: repairCount, reasons } })

    const previous = code
    code = await repairCode(config, code, report.checks, null, options.signal, log, tokenUsage, fallback)
    if (code === previous) {
      log('warn', 'Repair returned an identical module; stopping to avoid a loop.')
      break
    }
  }

  // Exhausted: return the best attempt with the fabrication gate still closed.
  const design: DesignResult = {
    slug: slugify(brief.title),
    title: brief.title,
    summary: brief.summary,
    tsx: code,
    circuitJson: [],
    checks: lastReport?.checks ?? [],
    stats:
      lastReport?.stats ?? {
        components: 0,
        sourceTraces: 0,
        routedTraces: 0,
        pcbLayers: 0,
        boardWidthMm: null,
        boardHeightMm: null,
        boardThicknessMm: null,
        solderMaskColor: null,
        silkscreenColor: null,
        nets: 0,
        vias: 0,
        holes: 0,
        elementCount: 0,
      },
    verified: false,
    blockingCount: lastReport?.blockingCount ?? 1,
    warningCount: lastReport?.warningCount ?? 0,
    iterations: MAX_REPAIRS + 1,
    model: config.model,
    fallbackUsed: fallback,
    partSearchUsed,
    fab: {
      presetId: options.fabPresetId,
      label: lastReport?.fabPresetLabel ?? options.fabPresetId,
      solderMask: boardColor.mask,
      silkscreen: boardColor.silk,
    },
    designHash: hash,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    repairCount,
    tokenUsage: { ...tokenUsage },
  }
  stage('error', 'Blocking checks remain — exports stay locked')
  send({ event: 'done', data: { design } })
  return design
}

async function generateCode(
  config: ServerConfig,
  brief: DesignBrief,
  signal: AbortSignal | undefined,
  log: (level: 'info' | 'warn', message: string) => void,
  tokenUsage: { input: number; output: number },
  onChunk: (chunk: string) => void,
  partSearchUsed: (used: boolean) => void,
): Promise<string> {
  const maxTokens = Math.max(CODEGEN_MAX_TOKENS_FLOOR, config.codegenMaxTokens)
  // Ground the generator in the installed API rather than in the model's memory of it.
  const reference = knowledgeContext(`${brief.summary} ${briefToPrompt(brief)}`)
  log('info', `Retrieval returned ${reference.length} chars of API reference.`)

  // The model is told either way whether a catalogue tool exists. Leaving it to guess is
  // how a model ends up inventing an MPN, and an invented MPN reads exactly like a real one
  // in the BOM.
  const partSearchOn = isPartSearchEnabled(config.partSearch)
  const system = [
    CODEGEN_SYSTEM_PROMPT,
    reference,
    partSearchNotice(partSearchOn),
  ]
    .filter(Boolean)
    .join('\n\n')

  const callOptions = {
    // No response_format here: Fireworks disables reasoning when json_schema is used,
    // and reasoning measurably improves the TSX. Parsing is defensive instead.
    maxTokens,
    temperature: 0.15,
    timeoutMs: Math.max(config.timeoutMs, 90_000),
    signal,
    logger: (entry: Record<string, unknown>) => log('info', `LLM ${JSON.stringify(entry)}`),
  }
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: codegenUserPrompt(briefToPrompt(brief)) },
  ]

  let content: string
  if (partSearchOn) {
    const loop = await callModelWithTools(config, messages, {
      ...callOptions,
      tools: [PART_SEARCH_TOOL],
      runTool: async (call) => {
        if (call.name !== PART_SEARCH_TOOL_NAME) {
          return JSON.stringify({ error: 'UNKNOWN_TOOL', message: `No tool named ${call.name}.` })
        }
        let args: { query?: unknown; limit?: unknown }
        try {
          args = JSON.parse(call.arguments) as { query?: unknown; limit?: unknown }
        } catch {
          throw new AppError('INPUT_INVALID', { internal: 'Tool arguments were not JSON.' })
        }
        const query = typeof args.query === 'string' ? args.query : ''
        const limit = typeof args.limit === 'number' ? args.limit : 5
        const parts = await searchParts(config.partSearch, query, limit, signal)
        log('info', `Part search for "${query.slice(0, 60)}" returned ${parts.length} result(s).`)
        return JSON.stringify(parts.slice(0, limit))
      },
    })
    tokenUsage.input += loop.usage.input
    tokenUsage.output += loop.usage.output
    content = loop.content
    partSearchUsed(loop.toolCalls.length > 0)
    if (loop.failedToolCalls.length > 0) {
      log('warn', 'Part search was called but failed; the design may name unverified parts.')
      partSearchUsed(false)
    }
    if (loop.rounds >= 3 && loop.toolCalls.length > 0) {
      log('warn', 'The model kept asking for parts; the tool round budget ran out.')
    }
  } else {
    const result = await callModel(config, messages, callOptions)
    tokenUsage.input += result.usage.input
    tokenUsage.output += result.usage.output
    content = result.content
  }

  const code = extractTsx(content)
  if (code.length < 40) {
    throw new AppError('LLM_INVALID_JSON', {
      internal: `Stage B produced no usable TSX (${code.length} chars). Raw: ${content.slice(0, 400)}`,
    })
  }
  onChunk(`${code.length} chars`)
  return code
}

async function repairCode(
  config: ServerConfig,
  code: string,
  checks: Array<{ severity: string; code: string; message: string }>,
  compileError: string | null,
  signal: AbortSignal | undefined,
  log: (level: 'info' | 'warn', message: string) => void,
  tokenUsage: { input: number; output: number },
  allowFallback: boolean,
): Promise<string> {
  const models = allowFallback && config.fallbackModel ? [config.model, config.fallbackModel] : [config.model]
  const last = code

  for (const model of models) {
    try {
      const result = await callModel(
        config,
        [
          { role: 'system', content: REPAIR_SYSTEM_PROMPT },
          { role: 'user', content: repairUserPrompt(code, checks, compileError) },
        ],
        {
          model,
          maxTokens: Math.max(CODEGEN_MAX_TOKENS_FLOOR, config.codegenMaxTokens),
          temperature: 0.1,
          timeoutMs: Math.max(config.timeoutMs, 90_000),
          signal,
          logger: (entry) => log('info', `LLM ${JSON.stringify(entry)}`),
        },
      )
      tokenUsage.input += result.usage.input
      tokenUsage.output += result.usage.output
      const repaired = extractTsx(result.content)
      if (repaired.length > 40) return repaired
    } catch (error) {
      log('warn', `Repair with ${model} failed: ${toAppError(error).code}`)
    }
  }
  return last
}
