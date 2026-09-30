/**
 * Defensive JSON extraction.
 *
 * LLM output is untrusted text. It may be:
 *   - clean JSON
 *   - wrapped in ```json fences
 *   - prefixed by reasoning prose (or `<think>…</think>` blocks)
 *   - followed by commentary
 *   - contain `{`/`}`/`"` inside string values
 *   - truncated mid-object (`finish_reason: "length"`)
 *   - empty, or a refusal in prose
 *
 * `extractJsonObject` finds the first *balanced* object using a real scanner that tracks
 * string state and escapes, never a greedy regex. `scanBalanced` reports truncation so the
 * caller can distinguish "truncated" from "malformed".
 */

export type ExtractResult =
  | { ok: true; value: unknown; source: string; truncated: false }
  | { ok: false; reason: 'empty' | 'no-object' | 'truncated' | 'invalid'; detail: string }

const OPENERS: Record<string, string> = { '{': '}', '[': ']' }

/**
 * Scan from `start` for a balanced JSON value. Returns the index just past the closing
 * bracket, or `{ truncated: true }` when the input ends before the value closes.
 */
export function scanBalanced(
  input: string,
  start = 0,
): { end: number; truncated: boolean } | null {
  const opener = input[start]
  if (!opener || !(opener in OPENERS)) return null
  const stack: string[] = [OPENERS[opener]]
  let inString = false
  let escaped = false

  for (let i = start + 1; i < input.length; i += 1) {
    const ch = input[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(OPENERS[ch])
      continue
    }
    if (ch === '}' || ch === ']') {
      const expected = stack.pop()
      if (expected === undefined) return { end: i + 1, truncated: false }
      if (expected !== ch) return { end: i + 1, truncated: false }
      if (stack.length === 0) return { end: i + 1, truncated: false }
    }
  }

  return { end: input.length, truncated: true }
}

/** Remove `<think>…</think>` / `<think>` blocks and markdown fences. */
export function stripReasoningAndFences(raw: string): string {
  let text = raw

  // Paired reasoning blocks.
  text = text.replace(/<(think|thinking|reasoning|scratchpad)>[\s\S]*?<\/\1>/gi, '\n')
  // Unclosed trailing reasoning block.
  text = text.replace(/<(think|thinking|reasoning|scratchpad)>[\s\S]*$/gi, '\n')

  // A ```json … ``` fence anywhere; keep the first fenced block that contains an object.
  const fence = /```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let fencedCandidate: string | null = null
  while ((match = fence.exec(text)) !== null) {
    const body = match[2] ?? ''
    if (body.includes('{') || body.includes('[')) {
      fencedCandidate = body
      break
    }
  }
  if (fencedCandidate !== null) text = fencedCandidate

  // Strip any remaining bare fences at the edges.
  text = text.replace(/^\s*```[ \t]*[A-Za-z0-9_+-]*[ \t]*\r?\n?/, '')
  text = text.replace(/```\s*$/, '')

  return text.trim()
}

/**
 * Pull the first balanced JSON object out of arbitrary model text.
 *
 * "First" is deliberate: prose before the answer often contains a brace or a fenced
 * example, and the real object is the first candidate that both balances and parses.
 * Every structured stage of this app returns an object, so an object is what we look for.
 */
export function extractJsonObject(raw: string): ExtractResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'empty', detail: 'empty response' }
  }

  const cleaned = stripReasoningAndFences(raw)
  let firstBalanced: string | null = null

  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] !== '{') continue
    const scan = scanBalanced(cleaned, i)
    if (!scan) continue
    if (scan.truncated) {
      return { ok: false, reason: 'truncated', detail: 'unbalanced braces: object never closed' }
    }
    const candidate = cleaned.slice(i, scan.end)
    if (firstBalanced === null) firstBalanced = candidate
    try {
      return { ok: true, value: JSON.parse(candidate), source: candidate, truncated: false }
    } catch {
      // Keep scanning: the first `{` may be prose, a later one may be the real object.
      continue
    }
  }

  if (firstBalanced !== null) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `a balanced object was found but did not parse: ${firstBalanced.slice(0, 200)}`,
    }
  }

  return { ok: false, reason: 'no-object', detail: 'no balanced JSON object found' }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
