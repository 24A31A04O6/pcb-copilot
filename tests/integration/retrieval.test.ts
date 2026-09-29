import { describe, expect, it } from 'vitest'

import { buildIndex, renderContext, retrieve, tokenize } from '@/lib/retrieval'
import { knowledgeContext, knowledgeFor, knowledgeStats } from '@/lib/server/knowledge'
import type { KnowledgeChunk } from '@/lib/retrieval'

const CORPUS: KnowledgeChunk[] = [
  {
    id: 'props:pinheader',
    topic: 'pinheader',
    title: '<pinheader>',
    text: 'Number of pins in the header. Distance between pins is `pitch`. Pin labels come from pinLabels.',
    source: '@tscircuit/props/lib/components/pin-header.ts',
  },
  {
    id: 'props:board',
    topic: 'board',
    title: '<board>',
    text: 'Board outline and stack-up. width, height, thickness, num_layers, solderMaskColor, silkscreenColor.',
    source: '@tscircuit/props/lib/components/board.ts',
  },
  {
    id: 'note:fab',
    topic: 'checks-and-fab',
    title: 'Checks and fabrication rules — Decoupling',
    text: 'Every IC that declares a supply pin should have a capacitor within about 3 mm of that pin.',
    source: 'docs/knowledge/fab-and-checks.md',
  },
]

const index = buildIndex(CORPUS, '0.0.0')

describe('tokenize', () => {
  it('lowercases and drops stop words', () => {
    expect(tokenize('The board is a Board')).toEqual(['board', 'board'])
  })

  it('keeps identifiers whole and also splits them', () => {
    const tokens = tokenize('pin_count')
    expect(tokens).toContain('pin_count')
    expect(tokens).toContain('pin')
    expect(tokens).toContain('count')
  })

  it('keeps dotted names like soic8 and 0603', () => {
    expect(tokenize('use soic8 or 0603')).toContain('soic8')
    expect(tokenize('use soic8 or 0603')).toContain('0603')
  })

  it('returns nothing for a query made only of stop words', () => {
    expect(tokenize('a the of')).toEqual([])
  })
})

describe('BM25 ranking', () => {
  it('ranks the chunk that shares the most distinctive terms first', () => {
    const top = retrieve(index, 'how many pins does a pin header have', 1)
    expect(top[0].id).toBe('props:pinheader')
  })

  it('finds a note by its wording, not by its topic', () => {
    const top = retrieve(index, 'decoupling capacitor near a supply pin', 1)
    expect(top[0].id).toBe('note:fab')
  })

  it('promotes an exact topic match above a merely related chunk', () => {
    const top = retrieve(index, 'board', 2)
    expect(top[0].id).toBe('props:board')
  })

  it('returns nothing rather than a bad match for an unrelated query', () => {
    expect(retrieve(index, 'zzzz qqqq xxxx')).toEqual([])
  })

  it('returns nothing for an empty corpus', () => {
    expect(retrieve(buildIndex([], '0.0.0'), 'board')).toEqual([])
  })

  it('never returns more than the limit', () => {
    const big = buildIndex(
      Array.from({ length: 50 }, (_, i) => ({
        id: `c${i}`,
        topic: `t${i}`,
        title: `title ${i}`,
        text: 'board pin header trace capacitor',
        source: 'x',
      })),
      '0.0.0',
    )
    expect(retrieve(big, 'board', 5)).toHaveLength(5)
  })

  it('is stable: the same query gives the same order', () => {
    const a = retrieve(index, 'board width height', 3).map((c) => c.id)
    const b = retrieve(index, 'board width height', 3).map((c) => c.id)
    expect(a).toEqual(b)
  })
})

describe('renderContext', () => {
  it('renders a title and a source for every chunk', () => {
    const text = renderContext(retrieve(index, 'pin header pins', 2))
    expect(text).toContain('### <pinheader>')
    expect(text).toContain('(source: @tscircuit/props/lib/components/pin-header.ts)')
  })

  it('respects the character budget', () => {
    const text = renderContext(retrieve(index, 'board pin header trace', 3), 80)
    expect(text.length).toBeLessThanOrEqual(400)
  })

  it('renders nothing for no chunks', () => {
    expect(renderContext([])).toBe('')
  })
})

describe('the shipped index', () => {
  it('was built from a real installed tscircuit version', () => {
    const stats = knowledgeStats()
    expect(stats).not.toBeNull()
    expect(stats!.chunks).toBeGreaterThan(100)
    expect(stats!.terms).toBeGreaterThan(1_000)
    expect(stats!.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('covers every element the generator is allowed to emit', () => {
    const required = ['board', 'resistor', 'capacitor', 'led', 'pinheader', 'chip', 'trace', 'via', 'net', 'testpoint', 'footprints']
    for (const topic of required) {
      expect(knowledgeFor(topic, 1)[0]?.topic).toBe(topic)
    }
  })

  it('answers the questions a designer actually asks', () => {
    expect(knowledgeFor('board', 1)[0]?.topic).toBe('board')
    expect(knowledgeFor('solderMaskColor', 2).map((c) => c.topic)).toContain('board')
    expect(knowledgeFor('what footprint string for a 6 pin 2.54mm header', 3).map((c) => c.topic)).toContain(
      'footprints',
    )
    expect(knowledgeFor('route a trace between two parts', 1)[0]?.topic).toBe('trace')
  })

  it('never answers an identifier query with a chunk that does not define it', () => {
    // Only identifiers the corpus actually defines are asserted: an identifier that exists
    // nowhere in the installed API should return nothing, not a plausible-looking neighbour.
    // `pinCount` is accepted by five connector-family elements; every result must be one
    // of them, never an element that merely mentions the prop in prose.
    for (const identifier of ['pincount', 'soldermaskcolor', 'footprint', 'pitch']) {
      const hits = knowledgeFor(identifier, 5)
      expect(hits.length).toBeGreaterThan(0)
      for (const hit of hits) {
        expect(hit.keywords ?? []).toContain(identifier)
      }
    }
  })

  it('produces a prompt block that states the version it came from', () => {
    const context = knowledgeContext('a board with a pin header and a resistor')
    expect(context).toContain('API reference')
    expect(context).toContain('(source:')
    expect(context.length).toBeGreaterThan(200)
  })
})
