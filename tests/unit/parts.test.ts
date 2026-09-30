/**
 * The optional part-search tool.
 *
 * Two things are being protected here, and they pull in opposite directions: the model must
 * be able to look up a real part, and it must never be left to invent one. The tests below
 * are mostly about the second.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors'
import {
  PART_SEARCH_TOOL,
  isPartSearchEnabled,
  normalisePart,
  partSearchNotice,
  searchParts,
  type PartSearchConfig,
} from '@/lib/server/parts'

const SOURCE = 'https://parts.example.test/v1/search'

function config(overrides: Partial<PartSearchConfig> = {}): PartSearchConfig {
  return { url: SOURCE, apiKey: null, timeoutMs: 1_000, enabled: true, ...overrides }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the tool definition', () => {
  it('is a function tool with a closed parameter object', () => {
    expect(PART_SEARCH_TOOL.type).toBe('function')
    expect(PART_SEARCH_TOOL.function.name).toBe('search_parts')
    expect(PART_SEARCH_TOOL.function.parameters).toMatchObject({
      type: 'object',
      required: ['query'],
      additionalProperties: false,
    })
  })

  it('tells the model not to invent part numbers', () => {
    expect(PART_SEARCH_TOOL.function.description).toMatch(/never invent an MPN/i)
  })
})

describe('enablement', () => {
  it('needs both the flag and a URL', () => {
    expect(isPartSearchEnabled(config())).toBe(true)
    expect(isPartSearchEnabled(config({ enabled: false }))).toBe(false)
    expect(isPartSearchEnabled(config({ url: null }))).toBe(false)
  })

  it('says something different in the prompt either way', () => {
    const on = partSearchNotice(true)
    const off = partSearchNotice(false)
    expect(on).toContain('search_parts')
    expect(off).toContain('no part-search tool')
    // The disabled notice is the one that matters: it is what stops an invented MPN.
    expect(off).toMatch(/do not invent manufacturer part numbers/i)
  })
})

describe('normalisePart', () => {
  it('accepts the several field names real backends use', () => {
    const part = normalisePart(
      { part_number: 'LM358DR', brand: 'Texas Instruments', price: 0.24, stock: 12_400 },
      'https://parts.example.test',
    )
    expect(part).toMatchObject({
      mpn: 'LM358DR',
      manufacturer: 'Texas Instruments',
      unitPriceUsd: 0.24,
      available: 12_400,
    })
  })

  it('drops a number that arrived as a string rather than passing it through', () => {
    const part = normalisePart({ mpn: 'X1', price: '0.24' }, 'src')
    expect(part?.unitPriceUsd).toBeNull()
  })

  it('rejects a record with no part number', () => {
    expect(normalisePart({ description: 'a resistor' }, 'src')).toBeNull()
    expect(normalisePart('LM358', 'src')).toBeNull()
    expect(normalisePart(null, 'src')).toBeNull()
  })

  it('rejects a hostile record without throwing', () => {
    expect(() => normalisePart({ mpn: { nested: true } }, 'src')).not.toThrow()
    expect(normalisePart({ mpn: { nested: true } }, 'src')).toBeNull()
  })
})

describe('searchParts', () => {
  it('sends the query and limit and normalises what comes back', async () => {
    const seen: { url: string; init: RequestInit | undefined } = { url: '', init: undefined }
    vi.stubGlobal('fetch', (url: string | URL, init: RequestInit) => {
      seen.url = String(url)
      seen.init = init
      return jsonResponse({ results: [{ mpn: 'LM358DR', manufacturer: 'TI' }] })
    })

    const parts = await searchParts(config({ apiKey: 'k'.repeat(30) }), '3.3V LDO', 3)
    expect(parts).toHaveLength(1)
    expect(parts[0].mpn).toBe('LM358DR')
    expect(parts[0].source).toBe('https://parts.example.test')
    expect(seen.url).toContain('q=3.3V+LDO')
    expect(seen.url).toContain('limit=3')
    expect((seen.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${'k'.repeat(30)}`)
  })

  it('omits the authorization header when there is no key', async () => {
    let headers: Record<string, string> = {}
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>
      return jsonResponse({ results: [] })
    })
    await searchParts(config(), 'anything', 1)
    expect(headers.authorization).toBeUndefined()
  })

  it('clamps a limit the model made up', async () => {
    let url = ''
    vi.stubGlobal('fetch', (requested: string | URL) => {
      url = String(requested)
      return jsonResponse({ results: [] })
    })
    await searchParts(config(), 'x', 9_999)
    expect(url).toContain('limit=10')
    await searchParts(config(), 'x', -3)
    expect(url).toContain('limit=1')
  })

  it('accepts a bare array as well as { results }', async () => {
    vi.stubGlobal('fetch', () => jsonResponse([{ mpn: 'A1' }]))
    await expect(searchParts(config(), 'x', 5)).resolves.toHaveLength(1)
  })

  it('fails loudly on a backend error rather than returning an empty list', async () => {
    vi.stubGlobal('fetch', () => jsonResponse({ error: 'nope' }, 503))
    await expect(searchParts(config(), 'x', 5)).rejects.toMatchObject({
      code: 'PART_SEARCH_UNAVAILABLE',
    })
  })

  it('fails loudly on a body it does not understand', async () => {
    vi.stubGlobal('fetch', () => jsonResponse({ data: { items: [] } }))
    await expect(searchParts(config(), 'x', 5)).rejects.toMatchObject({
      code: 'PART_SEARCH_UNAVAILABLE',
    })
  })

  it('times out rather than hanging the design', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await expect(searchParts(config({ timeoutMs: 1_000 }), 'x', 5)).rejects.toMatchObject({ code: 'LLM_TIMEOUT' })
  })

  it('refuses to run when it is not configured', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(searchParts(config({ url: null }), 'x', 5)).rejects.toBeInstanceOf(AppError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses an empty query instead of asking the backend for everything', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(searchParts(config(), '   ', 5)).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('drops records it cannot read instead of failing the whole search', async () => {
    vi.stubGlobal('fetch', () =>
      jsonResponse({ results: [{ mpn: 'GOOD1' }, null, 'nope', { description: 'no mpn' }] }),
    )
    const parts = await searchParts(config(), 'x', 5)
    expect(parts.map((p) => p.mpn)).toEqual(['GOOD1'])
  })
})
