import { describe, expect, it } from 'vitest'

import { extractJsonObject, isPlainObject, scanBalanced, stripReasoningAndFences } from '@/lib/llm/json'

describe('scanBalanced', () => {
  it('finds the end of a flat object', () => {
    expect(scanBalanced('{"a":1}', 0)).toEqual({ end: 7, truncated: false })
  })

  it('tracks nesting', () => {
    const input = '{"a":{"b":[1,2,{"c":3}]}}'
    expect(scanBalanced(input, 0)).toEqual({ end: input.length, truncated: false })
  })

  it('is not fooled by braces inside strings', () => {
    const input = '{"summary":"a } brace and a { brace"}'
    const scan = scanBalanced(input, 0)
    expect(scan).toEqual({ end: input.length, truncated: false })
  })

  it('is not fooled by escaped quotes or backslashes', () => {
    const input = String.raw`{"summary":"he said \"} \\\\ and stopped"}`
    expect(scanBalanced(input, 0)).toEqual({ end: input.length, truncated: false })
  })

  it('reports truncation instead of pretending the object closed', () => {
    expect(scanBalanced('{"a":1', 0)).toEqual({ end: 6, truncated: true })
    expect(scanBalanced('{"a":{"b":1', 0)?.truncated).toBe(true)
  })

  it('returns null when the character at start is not an opener', () => {
    expect(scanBalanced('hello', 0)).toBeNull()
    expect(scanBalanced('hello', 99)).toBeNull()
  })
})

describe('stripReasoningAndFences', () => {
  it('drops a paired reasoning block', () => {
    const out = stripReasoningAndFences('<think>hmm let me think</think>{"title":"x"}')
    expect(out).toBe('{"title":"x"}')
  })

  it('drops an unclosed trailing reasoning block', () => {
    const out = stripReasoningAndFences('{"title":"x"}<think>now I really')
    expect(out).toBe('{"title":"x"}')
  })

  it('keeps the first fenced block that actually contains a structure', () => {
    const raw = 'here you go\n```ts\nconst a = 1\n```\n```json\n{"title":"x"}\n```\nthanks!'
    expect(stripReasoningAndFences(raw)).toBe('{"title":"x"}')
  })
})

describe('extractJsonObject', () => {
  it('parses clean JSON', () => {
    const result = extractJsonObject('{"title":"Blinker","summary":"An LED."}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ title: 'Blinker', summary: 'An LED.' })
  })

  it('parses a fenced block', () => {
    const result = extractJsonObject('```json\n{"title":"Blinker"}\n```')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ title: 'Blinker' })
  })

  it('skips leading prose that itself contains braces', () => {
    const result = extractJsonObject('Use the {board} element like this: {"title":"Blinker"} — note the traces.')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ title: 'Blinker' })
  })

  it('keeps commentary after the object out of the result', () => {
    const result = extractJsonObject('{"title":"Blinker"} I chose 0603 parts because…')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ title: 'Blinker' })
  })

  it('handles a nested description containing braces and quotes', () => {
    const result = extractJsonObject('{"title":"X","summary":"use <board> then {trace} — \\"quoted\\""}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as { summary: string }
      expect(value.summary).toBe('use <board> then {trace} — "quoted"')
    }
  })

  it('reports truncation distinctly from malformed output', () => {
    const truncated = extractJsonObject('{"title":"Blinker","components":[{"ref":"R1"')
    expect(truncated).toMatchObject({ ok: false, reason: 'truncated' })
  })

  it('reports "no-object" for a prose refusal', () => {
    const refusal = extractJsonObject("I'm sorry, I can't help with that request.")
    expect(refusal).toMatchObject({ ok: false, reason: 'no-object' })
  })

  it('reports "empty" for nothing at all', () => {
    expect(extractJsonObject('')).toMatchObject({ ok: false, reason: 'empty' })
    expect(extractJsonObject('   \n  ')).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('reports "invalid" when the balanced object is not valid JSON', () => {
    const result = extractJsonObject('{title: Blinker}')
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('recovers the object when the model wrapped it in an array', () => {
    const result = extractJsonObject('[{"ref":"R1","value":"330"}]')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ ref: 'R1', value: '330' })
  })

  it('never throws, whatever it is given', () => {
    const inputs = ['{', '}', '"', '{\\"', '\u0000{}', '{{{}}}', '```\n```']
    for (const input of inputs) {
      expect(() => extractJsonObject(input)).not.toThrow()
    }
  })
})

describe('isPlainObject', () => {
  it('accepts objects only', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('x')).toBe(false)
  })
})
