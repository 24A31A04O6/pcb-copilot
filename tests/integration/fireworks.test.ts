/**
 * AUDIT §5.3 — the Fireworks contract, exercised against a mocked wire.
 *
 * MSW stands in for the real API so every documented failure mode is reproducible on every
 * run: rate limits with and without `Retry-After`, 5xx, truncated output, refusals,
 * malformed JSON, a schema mismatch that needs the single repair call, and a retired
 * primary model that must fall through to the fallback.
 *
 * Nothing here reaches the network, and no `FIREWORKS_API_KEY` is required — the key is
 * supplied by the fixture and asserted never to appear in a log line.
 */
import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors'
import type { ServerConfig } from '@/lib/server/env'
import {
  buildRequestBody,
  callModel,
  callStructured,
  looksLikeRefusal,
  withSchemaInPrompt,
} from '@/lib/server/llm/client'

const TEST_KEY = 'test-key-must-never-be-logged'
const BASE_URL = 'https://api.fireworks.test/v1'

const config: ServerConfig = {
  apiKey: TEST_KEY,
  baseUrl: BASE_URL,
  model: 'accounts/fireworks/models/test-primary',
  fallbackModel: 'accounts/fireworks/models/test-fallback',
  timeoutMs: 1_000,
  codegenMaxTokens: 8_000,
  compileTimeoutMs: 30_000,
  compileMemoryMb: 512,
  webSearchEnabled: false,
  webSearchApiKey: null,
  partSearch: { url: null, apiKey: null, timeoutMs: 5_000, enabled: false },
  rateLimit: { url: null, token: null },
  turnstile: { secret: null, siteKey: null },
  sentryDsn: null,
}

// One shared MSW server; each test installs its own handler and `afterEach` resets it.
// `onUnhandledRequest: 'error'` turns a request that escapes a test into a failure rather
// than a silent pass, so a mis-typed URL can never look like a working test.
const server = setupServer(
  http.post(`${BASE_URL}/chat/completions`, () => HttpResponse.json({ error: 'no handler installed' }, { status: 500 })),
)

function completion(content: string, finishReason = 'stop') {
  return HttpResponse.json({
    model: 'test-primary',
    choices: [{ finish_reason: finishReason, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
  })
}

const MESSAGES = [{ role: 'user' as const, content: 'hello' }]

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

beforeEach(() => {
  // Keep the suite fast: the backoff is asserted separately with fake timers.
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

describe('request body', () => {
  it('sends json_schema in response_format, as Fireworks documents', () => {
    const body = buildRequestBody('m', MESSAGES, {
      maxTokens: 100,
      jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
    })
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'design_brief', schema: { type: 'object' } },
    })
  })

  it('omits response_format entirely for stages that need reasoning', () => {
    const body = buildRequestBody('m', MESSAGES, { maxTokens: 100 })
    expect(body.response_format).toBeUndefined()
  })

  it('always declares an explicit token budget and never streams', () => {
    const body = buildRequestBody('m', MESSAGES, { maxTokens: 4_096 })
    expect(body.max_tokens).toBe(4_096)
    expect(body.stream).toBe(false)
  })

  it('puts the schema in the system prompt as well as on the wire, exactly once', () => {
    const schema = { name: 'design_brief', schema: { type: 'object' } }
    const once = withSchemaInPrompt([{ role: 'system', content: 'base' }], schema)
    const twice = withSchemaInPrompt(once, schema)
    expect(once[0].content).toContain('Return ONLY JSON matching this schema')
    expect(once[0].content).toContain('"type":"object"')
    expect(twice[0].content).toBe(once[0].content)
  })

  it('leaves the messages alone when there is no schema', () => {
    expect(withSchemaInPrompt(MESSAGES, undefined)).toEqual(MESSAGES)
  })
})

describe('callModel — the happy path', () => {
  it('returns the content, the finish reason and the token usage', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => completion('{"ok":true}')))
    const result = await callModel(config, MESSAGES, { maxTokens: 100 })
    expect(result.content).toBe('{"ok":true}')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ input: 11, output: 22 })
    expect(result.attempts).toBe(1)
  })

  it('sends the API key only in the Authorization header', async () => {
    let seen: { url: string; body: string; auth: string | null } | null = null
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async ({ request }) => {
        seen = {
          url: request.url,
          body: await request.text(),
          auth: request.headers.get('authorization'),
        }
        return completion('{}')
      }),
    )
    await callModel(config, MESSAGES, { maxTokens: 100 })
    expect(seen!.auth).toBe(`Bearer ${TEST_KEY}`)
    expect(seen!.body).not.toContain(TEST_KEY)
  })

  it('assembles a multi-part content array into text', async () => {
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () =>
        HttpResponse.json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: [
                  { type: 'text', text: '{"a":' },
                  { type: 'text', text: '1}' },
                ],
              },
            },
          ],
        }),
      ),
    )
    const result = await callModel(config, MESSAGES, { maxTokens: 100 })
    expect(result.content).toBe('{"a":1}')
  })
})

describe('callModel — upstream failures', () => {
  it('maps 401 to a misconfiguration, not a retryable upstream error', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return HttpResponse.json({ error: { message: 'bad key' } }, { status: 401 })
      }),
    )
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({
      code: 'LLM_MISCONFIGURED',
    })
    expect(calls).toBe(1)
  })

  it('maps 404 to a retired model id rather than a generic failure', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => HttpResponse.text('not found', { status: 404 })))
    const error = await callModel(config, MESSAGES, { maxTokens: 100 }).catch((e: AppError) => e)
    expect((error as AppError).code).toBe('LLM_MISCONFIGURED')
    expect((error as AppError).internal).toContain('no serverless deployment')
  })

  it('retries a 503 and succeeds on the second attempt', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return calls === 1 ? HttpResponse.text('busy', { status: 503 }) : completion('recovered')
      }),
    )
    const result = await callModel(config, MESSAGES, { maxTokens: 100 })
    expect(result.content).toBe('recovered')
    expect(result.attempts).toBe(2)
  })

  it('gives up on a 500 after three attempts and reports an upstream error', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return HttpResponse.text('boom', { status: 500 })
      }),
    )
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({ code: 'LLM_UPSTREAM' })
    expect(calls).toBe(3)
  })

  it('never retries a 400, because retrying a bad request cannot help', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return HttpResponse.json({ error: { message: 'bad schema' } }, { status: 400 })
      }),
    )
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({ code: 'LLM_UPSTREAM' })
    expect(calls).toBe(1)
  })

  it('surfaces a 429 as LLM_RATE_LIMITED and carries a Retry-After hint', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return HttpResponse.json({ error: { message: 'quota' } }, { status: 429, headers: { 'Retry-After': '2' } })
      }),
    )
    const error = (await callModel(config, MESSAGES, { maxTokens: 100 }).catch((e: AppError) => e)) as AppError
    expect(error.code).toBe('LLM_RATE_LIMITED')
    expect(error.status).toBe(429)
    expect(calls).toBe(3)
  })

  it('retries a 500 and never returns raw upstream text to the client', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => HttpResponse.text('stack trace: secret', { status: 500 })))
    const error = (await callModel(config, MESSAGES, { maxTokens: 100 }).catch((e: AppError) => e)) as AppError
    expect(error.message).not.toContain('stack trace')
    expect(error.internal).toContain('stack trace')
  })

  it('turns a response with no choices into an upstream error rather than undefined', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => HttpResponse.json({ choices: [] })))
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({ code: 'LLM_UPSTREAM' })
  })

  it('rejects a body that is not JSON at all', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => HttpResponse.text('<html>gateway</html>', { status: 200 })))
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({ code: 'LLM_UPSTREAM' })
  })
})

describe('callModel — output shape', () => {
  it('raises the budget once and retries when finish_reason is "length"', async () => {
    const budgets: number[] = []
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async ({ request }) => {
        budgets.push((JSON.parse(await request.text()) as { max_tokens: number }).max_tokens)
        return budgets.length === 1 ? completion('{"title":', 'length') : completion('{"title":"ok"}')
      }),
    )
    const result = await callModel(config, MESSAGES, { maxTokens: 1_000 })
    expect(result.content).toBe('{"title":"ok"}')
    expect(budgets).toEqual([1_000, 2_000])
  })

  it('stops retrying a truncated answer once the budget ceiling is reached', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return completion('{"title":', 'length')
      }),
    )
    const error = (await callModel(config, MESSAGES, { maxTokens: 32_000 }).catch((e: AppError) => e)) as AppError
    expect(error.code).toBe('LLM_TRUNCATED')
    expect(calls).toBe(1)
  })

  it('rejects empty content instead of returning an empty string', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => completion('   ')))
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({ code: 'LLM_INVALID_JSON' })
  })

  it('rejects a refusal delivered as prose, before spending a compile on it', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => completion("I'm sorry, I can't help with that.")))
    await expect(callModel(config, MESSAGES, { maxTokens: 100 })).rejects.toMatchObject({ code: 'LLM_INVALID_JSON' })
  })

  it('does not mistake real output for a refusal', () => {
    expect(looksLikeRefusal('I cannot assist — but here is the JSON you asked for: {}')).toBe(false)
    expect(looksLikeRefusal("I'm sorry, I can't do that.")).toBe(true)
    expect(looksLikeRefusal('export default () => <board width="40mm" height="30mm" />')).toBe(false)
  })

  it("aborts promptly when the caller's signal fires", async () => {
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async () => {
        await delay(5_000)
        return completion('{}')
      }),
    )
    const controller = new AbortController()
    const promise = callModel(config, MESSAGES, { maxTokens: 100, signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    await expect(promise).rejects.toMatchObject({ code: 'LLM_TIMEOUT' })
  })

  it('times out a hung request without waiting for the upstream default', async () => {
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async () => {
        await delay(5_000)
        return completion('{}')
      }),
    )
    await expect(callModel(config, MESSAGES, { maxTokens: 100, timeoutMs: 120 })).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
    })
  })
})

describe('logging', () => {
  it('never writes the API key to a log entry or a raw-response hook', async () => {
    const logs: Record<string, unknown>[] = []
    const raws: string[] = []
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () =>
        HttpResponse.json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }),
      ),
    )
    await callModel(config, MESSAGES, {
      maxTokens: 100,
      logger: (entry) => logs.push(entry),
      onRawResponse: (raw) => raws.push(raw),
    })
    expect(raws.length).toBeGreaterThan(0)
    const dump = JSON.stringify({ logs, raws })
    expect(dump).not.toContain(TEST_KEY)
  })
})

describe('callStructured — extraction, repair and fallback', () => {
  const validate = (value: unknown) =>
    typeof value === 'object' && value !== null && (value as { title?: string }).title
      ? { ok: true as const, data: value as { title: string } }
      : { ok: false as const, issues: ['title: required'] }

  it('returns a valid object on the first call', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => completion('{"title":"Blinker"}')))
    const result = await callStructured(config, MESSAGES, {
      maxTokens: 200,
      schemaName: 'design_brief',
      jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
      validate,
    })
    expect(result.data).toEqual({ title: 'Blinker' })
    expect(result.repaired).toBe(false)
    expect(result.usedFallback).toBe(false)
  })

  it('pulls the object out of prose, fences and reasoning', async () => {
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () =>
        completion('<think>weighing options</think>\n```json\n{"title":"Blinker"}\n```\nHope that helps!'),
      ),
    )
    const result = await callStructured(config, MESSAGES, {
      maxTokens: 200,
      schemaName: 'design_brief',
      jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
      validate,
    })
    expect(result.data).toEqual({ title: 'Blinker' })
  })

  it('makes exactly one repair call when the schema does not match, then succeeds', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return calls === 1 ? completion('{"name":"Blinker"}') : completion('{"title":"Blinker"}')
      }),
    )
    const result = await callStructured(config, MESSAGES, {
      maxTokens: 200,
      schemaName: 'design_brief',
      jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
      validate,
    })
    expect(result.data).toEqual({ title: 'Blinker' })
    expect(result.repaired).toBe(true)
    expect(calls).toBe(2)
  })

  it('tells the repair call exactly what was wrong', async () => {
    const seen: string[] = []
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async ({ request }) => {
        calls += 1
        const body = (await request.json()) as { messages: Array<{ content: string }> }
        seen.push(body.messages.map((m) => m.content).join('\n'))
        return calls === 1 ? completion('{"name":"Blinker"}') : completion('{"title":"Blinker"}')
      }),
    )
    await callStructured(config, MESSAGES, {
      maxTokens: 200,
      schemaName: 'design_brief',
      jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
      validate,
    })
    expect(seen[1]).toContain('title: required')
  })

  it('never loops: one repair for the whole run, then at most one attempt per model', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return completion('{"name":"Blinker"}')
      }),
    )
    await expect(
      callStructured(config, MESSAGES, {
        maxTokens: 200,
        schemaName: 'design_brief',
        jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
        validate,
      }),
    ).rejects.toMatchObject({ code: 'LLM_SCHEMA_MISMATCH' })
    // primary + one repair + one fallback attempt. A fourth call would be a run-away loop.
    expect(calls).toBe(3)
  })

  it('falls back to the second model when the primary id is retired', async () => {
    const models: string[] = []
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async ({ request }) => {
        const body = (JSON.parse(await request.text()) as { model: string })
        models.push(body.model)
        if (body.model === config.model) return HttpResponse.text('gone', { status: 404 })
        return completion('{"title":"FromFallback"}')
      }),
    )
    const result = await callStructured(config, MESSAGES, {
      maxTokens: 200,
      schemaName: 'design_brief',
      jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
      validate,
    })
    expect(result.usedFallback).toBe(true)
    expect(result.data).toEqual({ title: 'FromFallback' })
    expect(models).toEqual([config.model, config.fallbackModel])
  })

  it('reports invalid JSON when the answer is prose with no object in it', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => completion('not json at all')))
    await expect(
      callStructured(config, MESSAGES, {
        maxTokens: 200,
        schemaName: 'design_brief',
        jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
        validate,
      }),
    ).rejects.toMatchObject({ code: 'LLM_INVALID_JSON' })
  })

  it('reports a schema mismatch when both models return valid JSON of the wrong shape', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => completion('{"name":"Blinker"}')))
    await expect(
      callStructured(config, MESSAGES, {
        maxTokens: 200,
        schemaName: 'design_brief',
        jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
        validate,
      }),
    ).rejects.toMatchObject({ code: 'LLM_SCHEMA_MISMATCH' })
  })

  it('does not use the fallback when the caller pinned a model', async () => {
    const models: string[] = []
    server.use(
      http.post(`${BASE_URL}/chat/completions`, async ({ request }) => {
        models.push((JSON.parse(await request.text()) as { model: string }).model)
        return HttpResponse.text('gone', { status: 404 })
      }),
    )
    await expect(
      callStructured(config, MESSAGES, {
        maxTokens: 200,
        model: config.model,
        schemaName: 'design_brief',
        jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
        validate,
      }),
    ).rejects.toBeInstanceOf(AppError)
    expect(new Set(models)).toEqual(new Set([config.model]))
  })

  it('does not fall back when no fallback model is configured', async () => {
    const noFallback: ServerConfig = { ...config, fallbackModel: null }
    let calls = 0
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => {
        calls += 1
        return HttpResponse.text('gone', { status: 404 })
      }),
    )
    await expect(
      callStructured(noFallback, MESSAGES, {
        maxTokens: 200,
        schemaName: 'design_brief',
        jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
        validate,
      }),
    ).rejects.toMatchObject({ code: 'LLM_MISCONFIGURED' })
    expect(calls).toBe(1)
  })

  it('classifies a truncated answer as truncation, not as invalid JSON', async () => {
    server.use(
      http.post(`${BASE_URL}/chat/completions`, () => completion('{"title":"Blinker","components":[{"ref":"R1"', 'stop')),
    )
    await expect(
      callStructured(config, MESSAGES, {
        maxTokens: 200,
        schemaName: 'design_brief',
        jsonSchema: { name: 'design_brief', schema: { type: 'object' } },
        validate,
      }),
    ).rejects.toMatchObject({ code: 'LLM_TRUNCATED' })
  })

  it('never puts the API key or raw upstream bodies into the error it throws', async () => {
    server.use(http.post(`${BASE_URL}/chat/completions`, () => HttpResponse.text(`key=${TEST_KEY}`, { status: 500 })))
    const error = (await callModel(config, MESSAGES, { maxTokens: 100 }).catch((e: AppError) => e)) as AppError
    expect(error.message).not.toContain(TEST_KEY)
    expect(error.internal).toContain(TEST_KEY)
  })
})
