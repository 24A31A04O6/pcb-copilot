import '@/lib/server/only'

import { AppError } from '@/lib/errors'

/**
 * Optional part search.
 *
 * The model can ask for a real part number when a brief names a component it is unsure
 * about. That is genuinely useful and it is genuinely dangerous: a search tool that returns
 * a plausible-looking part when the backend is down turns a design the user can trust into
 * one they cannot. So this module has exactly one rule — if the answer is not a real answer
 * from a real backend, the call fails loudly and the design is flagged as having been
 * produced without part search.
 *
 * ## Why the endpoint is configurable rather than hard-coded
 *
 * There is no open, self-serve electronic-part search API that can be relied on from a
 * serverless function: SnapMagic (formerly SnapEDA) sells its Search API by request only,
 * and the Octopart/Nexar tier requires an approved application. Hard-coding a guess would
 * be inventing an API. Instead the deployment supplies `PART_SEARCH_URL` and
 * `WEB_SEARCH_API_KEY`, and the contract is the smallest one every HTTP JSON search can
 * satisfy: `GET {url}?q={query}&limit={n}` returning `{ results: PartRecord[] }`.
 *
 * This means the *tool*, the *loop*, the *timeouts*, the *error path* and the *flagging*
 * are all real and tested, while the vendor binding is the one part that needs a credential
 * this repository does not have. docs/DECISIONS.md records it as an unresolved external
 * prerequisite. With no `PART_SEARCH_URL` set, the tool is not offered at all and the model
 * is told so in its system prompt.
 */

/** One candidate part, normalised from whatever the backend returned. */
export type PartRecord = {
  /** Manufacturer part number, e.g. `LM358DR`. */
  mpn: string
  manufacturer: string | null
  description: string | null
  /** Package name as the backend words it, e.g. `SOIC-8`. */
  package: string | null
  /** Footprint the model should write, when the backend offers one. */
  footprint: string | null
  /** Stock across distributors, or null when the backend does not report it. */
  available: number | null
  /** Lowest published unit price in USD, or null. */
  unitPriceUsd: number | null
  /** Where the record came from, so the UI can show a provenance link. */
  source: string
}

export type PartSearchConfig = {
  url: string | null
  apiKey: string | null
  timeoutMs: number
  enabled: boolean
}

export const PART_SEARCH_TOOL_NAME = 'search_parts'

/** The tool definition, in the shape Fireworks' `tools` parameter expects. */
export const PART_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: PART_SEARCH_TOOL_NAME,
    description:
      'Search an electronic component distributor catalogue for real, orderable parts. Use it ' +
      'when the brief names a component and you are not certain of a manufacturer part number. ' +
      'Never invent an MPN: if this tool is not offered, choose a standard package instead.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text part search, e.g. "3.3V LDO 500mA SOT-23" or "LM358".',
        },
        limit: {
          type: 'integer',
          description: 'How many results to return, 1-10. Default 5.',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
}

function field(record: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function numberField(record: Record<string, unknown>, ...names: string[]): number | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/**
 * Normalise one backend record.
 *
 * Exported for the unit tests: a backend that returns a string where a number belongs must
 * drop the field, not put `"12"` into `unitPriceUsd` and have the UI print a price.
 */
export function normalisePart(raw: unknown, source: string): PartRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const mpn = field(record, 'mpn', 'part_number', 'partNumber', 'sku', 'manufacturerPartNumber')
  if (!mpn) return null
  return {
    mpn,
    manufacturer: field(record, 'manufacturer', 'brand', 'mfr'),
    description: field(record, 'description', 'desc', 'short_description'),
    package: field(record, 'package', 'packageName', 'packaging'),
    footprint: field(record, 'footprint', 'footprintName', 'land_pattern'),
    available: numberField(record, 'available', 'stock', 'quantity'),
    unitPriceUsd: numberField(record, 'unitPriceUsd', 'price', 'unit_price', 'lowest_price_usd'),
    source,
  }
}

export function isPartSearchEnabled(config: PartSearchConfig): boolean {
  return config.enabled && Boolean(config.url)
}

/**
 * Run one search. Throws `AppError` rather than returning an empty list on failure: an empty
 * list and a broken backend must not look the same to the caller.
 */
export async function searchParts(
  config: PartSearchConfig,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<PartRecord[]> {
  if (!isPartSearchEnabled(config)) {
    throw new AppError('LLM_MISCONFIGURED', { internal: 'Part search is enabled but no PART_SEARCH_URL is set.' })
  }
  const trimmed = query.trim()
  if (!trimmed) {
    throw new AppError('INPUT_INVALID', { internal: 'Part search called with an empty query.' })
  }
  const bounded = Math.min(Math.max(Math.trunc(limit) || 5, 1), 10)

  const endpoint = config.url as string
  const url = new URL(endpoint)
  url.searchParams.set('q', trimmed)
  url.searchParams.set('limit', String(bounded))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, config.timeoutMs))
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
    })
    if (!response.ok) {
      throw new AppError('PART_SEARCH_UNAVAILABLE', {
        internal: `Part search backend returned HTTP ${response.status}.`,
      })
    }
    const body: unknown = await response.json()
    const list = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)
        ? (body as { results: unknown[] }).results
        : null
    if (!list) {
      throw new AppError('PART_SEARCH_UNAVAILABLE', {
        internal: 'Part search backend did not return a "results" array.',
      })
    }
    return list.map((entry) => normalisePart(entry, new URL(endpoint).origin)).filter((p): p is PartRecord => p !== null)
  } catch (error) {
    if (error instanceof AppError) throw error
    // An abort is a timeout, not a backend bug, and the two are reported differently.
    const aborted = controller.signal.aborted && !signal?.aborted
    throw new AppError('LLM_TIMEOUT', {
      internal: aborted
        ? `Part search exceeded ${config.timeoutMs}ms.`
        : `Part search failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** The block appended to the system prompt, present either way so the model is never guessing. */
export function partSearchNotice(enabled: boolean): string {
  return enabled
    ? `You have a \`${PART_SEARCH_TOOL_NAME}\` tool. Use it to look up a real manufacturer part ` +
      'number when a brief names a component and you are unsure. Only use an MPN the tool ' +
      'returned; otherwise choose a standard package and say so.'
    : `There is no part-search tool in this session. Do not invent manufacturer part numbers. ` +
      'Use standard packages and common, widely available values instead, and say in your ' +
      'summary that the parts were not verified against a distributor.'
}
