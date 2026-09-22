import type { ServerConfig } from './config'

export type FireworksMessage = {
  role: 'system' | 'user'
  content: string
}

export type FireworksRequestOptions = {
  timeoutMs: number
  maxTokens: number
  jsonSchema?: Record<string, unknown>
}

type FireworksResponse = {
  choices?: Array<{
    finish_reason?: string
    message?: { content?: string; reasoning_content?: string }
  }>
  error?: { message?: string }
}

export async function requestFireworks(
  config: ServerConfig,
  messages: FireworksMessage[],
  options: FireworksRequestOptions,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(config.fireworksApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        max_tokens: options.maxTokens,
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
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new Error(
        'Fireworks timed out while generating the PCB. Please retry with a simpler board.',
      )
    }
    // Network-level failure (DNS, reset, blocked egress, offline, etc.)
    throw new Error(
      'Could not reach the Fireworks AI API (network error). Check that api.fireworks.ai is reachable from this server and retry.',
    )
  }

  const payload = (await response.json().catch(() => null)) as FireworksResponse | null

  if (response.status === 401) {
    throw new Error(
      'Fireworks rejected the API key (401). Check that FIREWORKS_API_KEY is valid and has quota.',
    )
  }
  if (response.status === 404) {
    throw new Error(
      `Fireworks could not find model "${config.modelId}" (404). Update the model id in lib/server/config.ts.`,
    )
  }
  if (response.status === 429) {
    throw new Error('Fireworks rate limit or quota exceeded (429). Wait and retry.')
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `Fireworks request failed with status ${response.status}.`,
    )
  }

  if (!payload?.choices?.length) {
    throw new Error('Fireworks returned no completion choices.')
  }

  const choice = payload.choices[0]
  const content =
    choice?.message?.content?.trim() ||
    choice?.message?.reasoning_content?.trim()

  if (!content) {
    if (
      choice?.finish_reason === 'length' ||
      choice?.finish_reason === 'max_tokens'
    ) {
      throw new Error(
        'Fireworks reached its output limit before completing the design. Increase max_tokens or simplify the board.',
      )
    }
    throw new Error('Fireworks returned an empty response.')
  }

  return content
}
