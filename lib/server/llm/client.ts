import '@/lib/server/only'

import { AppError } from '@/lib/errors'
import { extractJsonObject, isPlainObject } from '@/lib/llm/json'

import type { ServerConfig } from '../env'

/**
 * The one and only place a request is made to Fireworks.
 *
 * Every stage of the pipeline goes through `callModel`, so the timeout, the retry policy,
 * the `finish_reason` handling, the JSON extraction and the error taxonomy are enforced
 * uniformly and are testable in one place.
 */

/**
 * A conversation turn. `tool` is part of the wire format but not of anything this app
 * authors: only `callModelWithTools` ever produces one, immediately after a tool ran.
 */
export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

/** A tool the model may call, in the shape Fireworks' `tools` parameter expects. */
export type ToolDefinition = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** One tool call the model asked for. `arguments` is the raw JSON string it sent. */
export type ToolCall = { id: string; name: string; arguments: string }

export type CallOptions = {
  model?: string
  temperature?: number
  maxTokens: number
  timeoutMs?: number
  /**
   * When present, sent as `response_format: { type: 'json_schema' }` AND appended to the
   * system prompt, which is what Fireworks recommends.
   *
   * Note: Fireworks disables reasoning output when `json_schema` is used. Stages that
   * benefit from reasoning (code generation, repair) omit this and parse defensively.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  /** Tool definitions. When present, the model may return `tool_calls`. */
  tools?: ToolDefinition[]
  /**
   * 'auto' lets the model decide, 'none' forbids tool calls. `required` is deliberately not
   * supported: a model forced to call a tool on every request would call it on requests
   * that do not need it, which costs a round trip and teaches nothing.
   */
  toolChoice?: 'auto' | 'none'
  /** Retry only for these statuses. 400/401/403/404/422 are never retried. */
  signal?: AbortSignal
  requestId?: string
  /** Called with a redacted, truncated copy of every upstream body. Never the key. */
  onRawResponse?: (raw: string) => void
  logger?: (entry: Record<string, unknown>) => void
}

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | Array<{ type: string; text?: string }> | null
      reasoning_content?: string | null
      tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> | null
    }
  }>
  error?: { message?: string; code?: string; type?: string }
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  model?: string
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524])
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 600
const MAX_BACKOFF_MS = 8_000

export type ModelResult = {
  content: string
  reasoning: string | null
  finishReason: string
  model: string
  usage: { input: number; output: number }
  attempts: number
  /** Tool calls the model requested, in order. Empty when no tools were offered. */
  toolCalls: ToolCall[]
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('LLM_TIMEOUT', { internal: 'aborted before backoff' }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AppError('LLM_TIMEOUT', { internal: 'aborted during backoff' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000)
    }
    const date = Date.parse(header)
    if (Number.isFinite(date)) {
      return Math.min(Math.max(0, date - Date.now()), 30_000)
    }
  }
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
  return exponential + Math.random() * 250
}

function contentToText(content: ChatCompletionResponse['choices'] extends undefined ? never : NonNullable<ChatCompletionResponse['choices']>[number]['message']): string {
  const raw = content?.content
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (part && typeof part === 'object' && part.type === 'text' ? (part.text ?? '') : ''))
      .join('')
  }
  return ''
}

function jsonSchemaHint(options: CallOptions): string {
  return options.jsonSchema ? 'the requested JSON object' : 'a design'
}

/**
 * A refusal is prose, and prose never becomes a tscircuit module or a JSON brief.
 *
 * Requiring *both* a refusal phrase and the absence of any code marker keeps this from
 * rejecting real output: a brief that happens to say "I can build that" still contains a
 * `{`, and generated TSX always contains a tag or an `export`.
 */
export function looksLikeRefusal(content: string): boolean {
  if (content.includes('<') || content.includes('export ') || content.includes('{')) return false
  const phrases = [
    "i can't",
    'i cannot',
    "i'm sorry",
    'i am sorry',
    'i am unable',
    "i'm unable",
    'unable to assist',
    'cannot assist',
  ]
  const lower = content.toLowerCase()
  return phrases.some((phrase) => lower.includes(phrase))
}

function truncateForLog(value: string, max = 1_500): string {
  return value.length <= max ? value : `${value.slice(0, max)}… [${value.length} chars total]`
}

export function buildRequestBody(
  model: string,
  messages: Message[],
  options: CallOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens,
    messages,
    stream: false,
  }
  if (options.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema },
    }
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools
    body.tool_choice = options.toolChoice ?? 'auto'
  }
  return body
}

/** Tool calls a model asked for, with the malformed ones dropped rather than thrown on. */
export function extractToolCalls(message: ChatCompletionResponse['choices'] extends undefined
  ? never
  : NonNullable<ChatCompletionResponse['choices']>[number]['message']): ToolCall[] {
  const calls = message?.tool_calls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call) => {
    const name = call.function?.name
    const id = call.id
    if (!name || !id) return []
    return [{ id, name, arguments: call.function?.arguments ?? '{}' }]
  })
}

/** Fireworks recommends the schema in both the prompt and `response_format`. */
export function withSchemaInPrompt(messages: Message[], jsonSchema: CallOptions['jsonSchema']): Message[] {
  if (!jsonSchema) return messages
  const rendered = JSON.stringify(jsonSchema.schema)
  const [first, ...rest] = messages
  if (!first) return messages
  const instruction = `\n\nReturn ONLY JSON matching this schema, with no other text:\n${rendered}`
  const patched: Message = {
    ...first,
    content: first.content.includes('Return ONLY JSON matching this schema')
      ? first.content
      : first.content + instruction,
  }
  return [patched, ...rest]
}

function statusToError(status: number, model: string, body: string): AppError {
  if (status === 401 || status === 403) {
    return new AppError('LLM_MISCONFIGURED', {
      internal: `Fireworks rejected the API key (${status}). FIREWORKS_API_KEY is invalid or lacks access to model ${model}.`,
    })
  }
  if (status === 404) {
    return new AppError('LLM_MISCONFIGURED', {
      internal: `Fireworks has no serverless deployment for model "${model}" (404). The model id is retired or wrong.`,
    })
  }
  if (status === 429) {
    return new AppError('LLM_RATE_LIMITED', {
      internal: `Fireworks rate limit or quota exceeded (429) for ${model}.`,
      retryAfterSeconds: 30,
    })
  }
  if (status === 400 || status === 422) {
    return new AppError('LLM_UPSTREAM', {
      internal: `Fireworks rejected the request (${status}): ${truncateForLog(body)}`,
    })
  }
  return new AppError('LLM_UPSTREAM', {
    internal: `Fireworks request failed (${status}) for ${model}: ${truncateForLog(body)}`,
  })
}

export async function callModel(
  config: ServerConfig,
  messages: Message[],
  options: CallOptions,
): Promise<ModelResult> {
  const model = options.model ?? config.model
  const timeoutMs = options.timeoutMs ?? config.timeoutMs
  const outbound = options.jsonSchema ? withSchemaInPrompt(messages, options.jsonSchema) : messages
  const body = buildRequestBody(model, outbound, options)
  const log = options.logger ?? (() => {})

  let lastError: AppError | null = null
  // Set when the HTTP layer has already decided this failure is not worth retrying
  // (400/401/403/404/422). Without it the catch-all below would happily retry a
  // malformed request three times.
  let giveUp = false

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) {
      throw new AppError('LLM_TIMEOUT', { internal: 'client aborted before attempt' })
    }

    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
    const combined = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combined,
        cache: 'no-store',
      })

      const text = await response.text()
      let payload: ChatCompletionResponse | null = null
      try {
        payload = text ? (JSON.parse(text) as ChatCompletionResponse) : null
      } catch {
        payload = null
      }

      if (!response.ok) {
        const error = statusToError(response.status, model, text)
        options.onRawResponse?.(
          `[${response.status}] ${truncateForLog(text)}`,
        )
        log({ event: 'llm.http_error', model, status: response.status, attempt })

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
          lastError = error
          await sleep(retryAfterMs(response, attempt), options.signal)
          continue
        }
        giveUp = !RETRYABLE_STATUS.has(response.status)
        if (error.code === 'LLM_RATE_LIMITED') {
          throw new AppError('LLM_RATE_LIMITED', {
            internal: error.internal,
            retryAfterSeconds: retryAfterMs(response, attempt) / 1000,
          })
        }
        throw error
      }

      const choice = payload?.choices?.[0]
      if (!choice) {
        options.onRawResponse?.(`[200] ${truncateForLog(text)}`)
        throw new AppError('LLM_UPSTREAM', {
          internal: `Fireworks returned no completion choices for ${model}.`,
        })
      }

      const finishReason = choice.finish_reason ?? 'stop'
      const content = contentToText(choice.message)
      const reasoning = choice.message?.reasoning_content?.trim() || null
      options.onRawResponse?.(`[200 finish=${finishReason}] ${truncateForLog(text)}`)

      if (finishReason === 'length') {
        // The JSON is almost certainly cut mid-object. One retry with a bigger budget.
        if (options.maxTokens < 32_000) {
          log({ event: 'llm.truncated', model, attempt, maxTokens: options.maxTokens })
          if (attempt < MAX_ATTEMPTS - 1) {
            body.max_tokens = Math.min(options.maxTokens * 2, 32_000)
            lastError = new AppError('LLM_TRUNCATED', {
              internal: `finish_reason=length at max_tokens=${options.maxTokens}`,
            })
            continue
          }
        }
        throw new AppError('LLM_TRUNCATED', {
          internal: `finish_reason=length for ${model} at max_tokens=${options.maxTokens}. Raw: ${truncateForLog(content, 400)}`,
        })
      }

      const toolCalls = extractToolCalls(choice.message)
      if (toolCalls.length > 0) {
        // A turn that ends in a tool call has no content yet. Empty content is only an error
        // once the model has actually been allowed to answer.
        return {
          content,
          reasoning,
          finishReason,
          model: payload?.model ?? model,
          usage: {
            input: payload?.usage?.prompt_tokens ?? 0,
            output: payload?.usage?.completion_tokens ?? 0,
          },
          attempts: attempt + 1,
          toolCalls,
        }
      }

      if (content.trim() === '') {
        throw new AppError('LLM_INVALID_JSON', {
          internal: `Fireworks returned empty content for ${model} (finish_reason=${finishReason}, reasoning=${reasoning ? 'present' : 'absent'}).`,
        })
      }

      if (looksLikeRefusal(content)) {
        throw new AppError('LLM_INVALID_JSON', {
          internal: `Fireworks returned a refusal instead of ${jsonSchemaHint(options)} for ${model}.`,
        })
      }

      return {
        content,
        reasoning,
        finishReason,
        model: payload?.model ?? model,
        usage: {
          input: payload?.usage?.prompt_tokens ?? 0,
          output: payload?.usage?.completion_tokens ?? 0,
        },
        attempts: attempt + 1,
        toolCalls: [],
      }
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : error instanceof DOMException && error.name === 'AbortError'
            ? new AppError('LLM_TIMEOUT', {
                internal: `Fireworks request to ${model} timed out after ${timeoutMs}ms.`,
              })
            : new AppError('LLM_UPSTREAM', {
                cause: error,
                internal: `Network error calling ${model}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              })

      if (options.signal?.aborted) {
        throw new AppError('LLM_TIMEOUT', { internal: 'client aborted the design run' })
      }
      if (giveUp || appError.code === 'LLM_MISCONFIGURED') throw appError

      lastError = appError
      log({ event: 'llm.attempt_failed', model, attempt, code: appError.code })

      if (appError.code === 'LLM_TRUNCATED' || attempt >= MAX_ATTEMPTS - 1) throw appError
      await sleep(retryAfterMs(new Response(null, { status: 503 }), attempt), options.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new AppError('LLM_UPSTREAM', { internal: 'callModel exhausted retries' })
}

export type StructuredResult<T> = {
  data: T
  raw: string
  model: string
  usage: { input: number; output: number }
  attempts: number
  repaired: boolean
  usedFallback: boolean
}

/**
 * Call the model and parse a JSON object that satisfies `validate`.
 *
 * Order of operations, all of it covered by tests:
 *  1. primary call with `json_schema`
 *  2. defensive extraction + validation
 *  3. one repair call with the exact validation errors
 *  4. one fallback-model call
 *  5. a typed error
 */
export async function callStructured<T>(
  config: ServerConfig,
  messages: Message[],
  options: CallOptions & {
    schemaName: string
    validate: (value: unknown) => { ok: true; data: T } | { ok: false; issues: string[] }
  },
): Promise<StructuredResult<T>> {
  const log = options.logger ?? (() => {})
  const jsonSchema = { name: options.schemaName, schema: options.jsonSchema?.schema ?? {} }
  let usedFallback = false
  let repaired = false

  const models = [options.model ?? config.model]
  if (config.fallbackModel && !options.model) models.push(config.fallbackModel)

  let lastError: AppError | null = null

  for (const model of models) {
    usedFallback = model !== models[0]

    let result: ModelResult
    try {
      result = await callModel(config, messages, {
        ...options,
        model,
        jsonSchema: options.jsonSchema ?? jsonSchema,
      })
    } catch (error) {
      lastError = error instanceof AppError ? error : new AppError('LLM_UPSTREAM', { cause: error })
      if (lastError.code === 'LLM_MISCONFIGURED' && usedFallback) {
        // A bad primary model must not stop the fallback from being tried.
        log({ event: 'llm.fallback_after_config_error', model })
      }
      continue
    }

    const attempt = (raw: string) => {
      const extracted = extractJsonObject(raw)
      if (!extracted.ok) {
        throw new AppError(
          extracted.reason === 'truncated' ? 'LLM_TRUNCATED' : 'LLM_INVALID_JSON',
          { internal: `JSON extraction failed (${extracted.reason}): ${extracted.detail}` },
        )
      }
      const validated = options.validate(extracted.value)
      if (!validated.ok) {
        throw new AppError('LLM_SCHEMA_MISMATCH', { details: validated.issues.slice(0, 5) })
      }
      return validated.data
    }

    let data: T
    try {
      data = attempt(result.content)
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError('LLM_INVALID_JSON', { cause: error })
      if (appError.code === 'LLM_TRUNCATED' || repaired) {
        lastError = appError
        continue
      }

      // Exactly one repair call.
      repaired = true
      log({ event: 'llm.repair_call', model, code: appError.code })
      try {
        const repairResult = await callModel(
          config,
          [
            ...messages,
            { role: 'assistant', content: truncateForLog(result.content, 4_000) },
            {
              role: 'user',
              content: [
                'That response was rejected.',
                `Reason: ${appError.code}.`,
                appError.details.length ? `Validation errors:\n${appError.details.join('\n')}` : '',
                'Return ONLY the corrected JSON object. No prose, no markdown fences, no commentary.',
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
          {
            ...options,
            model,
            jsonSchema: options.jsonSchema ?? jsonSchema,
            temperature: 0,
          },
        )
        data = attempt(repairResult.content)
        return {
          data,
          raw: repairResult.content,
          model: repairResult.model,
          usage: repairResult.usage,
          attempts: repairResult.attempts,
          repaired: true,
          usedFallback,
        }
      } catch (repairError) {
        lastError =
          repairError instanceof AppError
            ? repairError
            : new AppError('LLM_SCHEMA_MISMATCH', { cause: repairError })
        continue
      }
    }

    return {
      data,
      raw: result.content,
      model: result.model,
      usage: result.usage,
      attempts: result.attempts,
      repaired: false,
      usedFallback,
    }
  }

  throw (
    lastError ??
    new AppError('LLM_UPSTREAM', { internal: 'callStructured exhausted every model' })
  )
}

/** Convenience wrapper so callers never accidentally accept a non-object. */
export function requireObject(value: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] } {
  if (!isPlainObject(value)) return { ok: false, issues: ['Expected a JSON object at the top level.'] }
  return { ok: true, data: value }
}

/**
 * Run a tool-calling turn to completion.
 *
 * The loop is bounded by `maxToolRounds` and by the fact that a model which keeps asking for
 * the same tool has nothing left to say. Every tool result goes back into the transcript, so
 * the model can see what it got, including a failure: a tool that throws returns the error
 * text as its result rather than aborting the design, because a model told "the catalogue is
 * unreachable, use a standard package" produces a better board than no board at all.
 *
 * The caller is told whether any tool actually ran, and whether it failed, so the design can
 * be labelled honestly instead of implying the parts were verified when they were not.
 */
export type ToolLoopResult = {
  content: string
  model: string
  usage: { input: number; output: number }
  rounds: number
  /** Tool calls that were made, flattened across rounds. */
  toolCalls: ToolCall[]
  /** Tool calls whose handler threw. The turn still completed. */
  failedToolCalls: string[]
}

export async function callModelWithTools(
  config: ServerConfig,
  messages: Message[],
  options: CallOptions & {
    tools: ToolDefinition[]
    runTool: (call: ToolCall) => Promise<string>
    maxToolRounds?: number
  },
): Promise<ToolLoopResult> {
  const maxRounds = Math.max(1, options.maxToolRounds ?? 3)
  const transcript: Message[] = [...messages]
  const usage = { input: 0, output: 0 }
  const allCalls: ToolCall[] = []
  const failed: string[] = []
  let rounds = 0
  let lastModel = options.model ?? config.model
  let content = ''

  while (rounds < maxRounds) {
    const result = await callModel(config, transcript, {
      ...options,
      tools: options.tools,
      toolChoice: 'auto',
    })
    usage.input += result.usage.input
    usage.output += result.usage.output
    lastModel = result.model
    rounds += 1
    content = result.content

    if (result.toolCalls.length === 0) {
      return { content, model: lastModel, usage, rounds, toolCalls: allCalls, failedToolCalls: failed }
    }

    transcript.push({ role: 'assistant', content: result.content })
    for (const call of result.toolCalls) {
      allCalls.push(call)
      let payload: string
      try {
        payload = await options.runTool(call)
      } catch (error) {
        failed.push(call.name)
        // The failure text is the result the model gets. It has to say what went wrong, or
        // the model will simply ask again.
        payload = JSON.stringify({
          error: error instanceof AppError ? error.code : 'PART_SEARCH_FAILED',
          message: 'Part search did not complete. Choose a standard package instead.',
        })
      }
      transcript.push({ role: 'tool', tool_call_id: call.id, content: payload })
    }
  }

  // Out of rounds with the model still asking for tools. Whatever it has said so far is
  // better than nothing, and the caller is told the round budget ran out.
  return { content, model: lastModel, usage, rounds, toolCalls: allCalls, failedToolCalls: failed }
}
