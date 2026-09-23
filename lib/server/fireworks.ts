import type { ServerConfig } from './config'

export type FireworksMessage = {
  role: 'system' | 'user'
  content: string
}

export type FireworksRequestOptions = {
  timeoutMs: number
  maxTokens: number
  jsonSchema?: Record<string, unknown>
  signal?: AbortSignal
  retries?: number
}

type FireworksResponse = {
  choices?: Array<{
    finish_reason?: string
    message?: { content?: string | Array<{ type: string; text?: string }>; reasoning_content?: string }
  }>
  error?: { message?: string; code?: string }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(id)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

function extractContentFromChoice(choice: FireworksResponse['choices'] extends (infer U)[] | undefined ? U : never): string {
  if (!choice?.message) return ''
  const msg = choice.message
  if (typeof msg.content === 'string') {
    return msg.content.trim() || msg.reasoning_content?.trim() || ''
  }
  if (Array.isArray(msg.content)) {
    const text = msg.content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part.type === 'text' && part.text) return part.text
        return ''
      })
      .join('')
      .trim()
    if (text) return text
  }
  return msg.reasoning_content?.trim() || ''
}

export async function requestFireworks(
  config: ServerConfig,
  messages: FireworksMessage[],
  options: FireworksRequestOptions,
): Promise<string> {
  const maxRetries = options.retries ?? 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError')
    }

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal

    try {
      const response = await fetch(config.fireworksApiUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'User-Agent': 'pcb-copilot/1.0',
        },
        body: JSON.stringify({
          model: config.modelId,
          max_tokens: options.maxTokens,
          temperature: 0.2,
          top_p: 0.9,
          messages,
          ...(options.jsonSchema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: 'pcb_design_brief',
                    schema: options.jsonSchema,
                  },
                },
              }
            : {}),
        }),
        signal: combinedSignal,
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as FireworksResponse | null

      if (response.status === 401) {
        throw new Error(
          'Fireworks rejected the API key (401). Check that FIREWORKS_API_KEY is valid and has quota.',
        )
      }
      if (response.status === 404) {
        throw new Error(
          `Fireworks could not find model "${config.modelId}" (404). Update FIREWORKS_MODEL_ID.`,
        )
      }
      if (response.status === 429) {
        if (attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000)
          await sleep(backoff, options.signal)
          continue
        }
        throw new Error('Fireworks rate limit or quota exceeded (429). Wait and retry.')
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 5000)
        await sleep(backoff, options.signal)
        continue
      }

      if (!response.ok) {
        throw new Error(
          payload?.error?.message || `Fireworks request failed with status ${response.status}.`,
        )
      }

      if (!payload?.choices?.length) {
        throw new Error('Fireworks returned no completion choices.')
      }

      const choice = payload.choices[0]
      const content = extractContentFromChoice(choice)

      if (!content) {
        if (choice?.finish_reason === 'length' || choice?.finish_reason === 'max_tokens') {
          throw new Error(
            'Fireworks reached its output limit before completing the design. Simplify the board or increase max_tokens.',
          )
        }
        throw new Error('Fireworks returned an empty response.')
      }

      return content
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (error instanceof DOMException && error.name === 'AbortError') {
        if (options.signal?.aborted) {
          throw new DOMException('Client aborted the request', 'AbortError')
        }
        if (attempt < maxRetries) {
          // Timeout - retry once with longer timeout
          await sleep(500, options.signal)
          continue
        }
        throw new Error(
          'Fireworks timed out while generating the PCB. Please retry with a simpler board.',
        )
      }

      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.message.includes('timed out'))
      ) {
        if (attempt < maxRetries) {
          await sleep(500, options.signal)
          continue
        }
        throw new Error(
          'Fireworks timed out while generating the PCB. Please retry with a simpler board.',
        )
      }

      // Network errors - retry if possible
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes('fetch')) ||
        (error instanceof Error && error.message.includes('network'))
      ) {
        if (attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 4000)
          await sleep(backoff, options.signal)
          continue
        }
        throw new Error(
          'Could not reach the Fireworks AI API (network error). Check connectivity and retry.',
        )
      }

      // Non-retryable
      throw error
    }
  }

  throw lastError ?? new Error('Fireworks request failed after retries.')
}

/**
 * Streaming variant that yields text chunks via callback.
 * Falls back to non-streaming if streaming fails.
 */
export async function requestFireworksStream(
  config: ServerConfig,
  messages: FireworksMessage[],
  options: FireworksRequestOptions & { onChunk?: (chunk: string) => void },
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal

  try {
    const response = await fetch(config.fireworksApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        max_tokens: options.maxTokens,
        temperature: 0.2,
        top_p: 0.9,
        stream: true,
        messages,
      }),
      signal: combinedSignal,
      cache: 'no-store',
    })

    if (!response.ok || !response.body) {
      // Fallback to non-streaming
      return requestFireworks(config, messages, options)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue
        try {
          const json = JSON.parse(trimmed.slice(6))
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? ''
          if (delta) {
            fullText += delta
            options.onChunk?.(delta)
          }
        } catch {
          // Ignore parse errors for streaming chunks
        }
      }
    }

    if (fullText.trim()) return fullText.trim()
    // If streaming yielded nothing, fallback
    return requestFireworks(config, messages, options)
  } catch {
    // On any streaming failure, fallback to non-streaming
    return requestFireworks(config, messages, options)
  }
}
