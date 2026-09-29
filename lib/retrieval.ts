/**
 * BM25 retrieval over the tscircuit API knowledge base.
 *
 * The index is built at build time by `scripts/build-knowledge-index.ts` from the *installed*
 * `@tscircuit/props` source and a small set of hand-written notes, then committed as JSON.
 * Generated from the installed version means the documentation handed to the model cannot
 * describe an API the compiler does not have.
 *
 * BM25 rather than embeddings: the corpus is a few hundred short, highly technical chunks
 * with exact identifiers (`pinCount`, `solderMaskColor`, `soic8`), and a lexical ranking
 * function gets those right with no model call, no vector store and no network. See
 * docs/DECISIONS.md.
 */

export type KnowledgeChunk = {
  id: string
  /** Element or topic name, e.g. `pinheader`, `footprints`, `decoupling`. */
  topic: string
  title: string
  text: string
  source: string
  /**
   * Identifiers this chunk *defines*: the element name and its prop names.
   *
   * `pinCount` appears in five chunks because five components accept it, so plain BM25
   * cannot say which one owns it. Scoring a match against `keywords` does. Filled in by
   * the index builder; optional for hand-written chunks.
   */
  keywords?: string[]
}

export type KnowledgeIndex = {
  /** Bumped when the chunking or tokenizer changes, so a stale index is detectable. */
  format: number
  builtFrom: { package: string; version: string }
  chunks: KnowledgeChunk[]
  /** Per-chunk term frequency, keyed by chunk id then term. */
  termFrequency: Record<string, Record<string, number>>
  /** Document frequency per term across the whole corpus. */
  documentFrequency: Record<string, number>
  /** Chunks per term, used to build the inverse document frequency table. */
  postings: Record<string, number[]>
  averageLength: number
}

export type RetrievedChunk = KnowledgeChunk & { score: number }

const K1 = 1.2
const B = 0.75

/**
 * Lowercase, split on anything that is not a letter, digit, `_`, `.` or `-`, and drop the
 * stop words. Identifiers are kept whole *and* split on `_`/`-`, so `pin_count` matches a
 * query for either "pin" or "count".
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with', 'you',
])

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9_.-]+/)) {
    if (!raw) continue
    if (STOP_WORDS.has(raw)) continue
    if (raw.length > 2) tokens.push(raw)
    if (/[_-]/.test(raw)) {
      for (const part of raw.split(/[_-]+/)) {
        if (part.length > 2 && !STOP_WORDS.has(part)) tokens.push(part)
      }
    }
  }
  return tokens
}

export function buildTermFrequency(text: string): Record<string, number> {
  const frequency: Record<string, number> = {}
  for (const token of tokenize(text)) {
    frequency[token] = (frequency[token] ?? 0) + 1
  }
  return frequency
}

/** Build the whole index from chunks. Exported so the builder and the tests share it. */
/** How much a defined-identifier match is worth relative to a body-text match. */
const KEYWORD_BOOST = 4

export function buildIndex(
  chunks: KnowledgeChunk[],
  packageVersion: string,
): KnowledgeIndex {
  const termFrequency: Record<string, Record<string, number>> = {}
  const documentFrequency: Record<string, number> = {}
  const postings: Record<string, number[]> = {}
  let totalLength = 0

  chunks.forEach((chunk, index) => {
    // The title and topic are indexed with the body so a bare element name still ranks.
    const frequency = buildTermFrequency(`${chunk.topic} ${chunk.title} ${chunk.text}`)
    termFrequency[chunk.id] = frequency
    totalLength += Object.values(frequency).reduce((sum, n) => sum + n, 0)
    for (const term of Object.keys(frequency)) {
      documentFrequency[term] = (documentFrequency[term] ?? 0) + 1
      ;(postings[term] ??= []).push(index)
    }
  })

  return {
    format: 1,
    builtFrom: { package: '@tscircuit/props', version: packageVersion },
    chunks,
    termFrequency,
    documentFrequency,
    postings,
    averageLength: chunks.length === 0 ? 0 : totalLength / chunks.length,
  }
}

/**
 * Rank chunks for a query.
 *
 * `topicBoost` promotes a chunk whose topic matches the query exactly, which is what makes
 * "how do I set pinCount" return `<pinheader>` first and the generic layout notes fifth.
 */
export function retrieve(index: KnowledgeIndex, query: string, limit = 6): RetrievedChunk[] {
  if (index.chunks.length === 0) return []
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []

  const total = index.chunks.length
  const scores = new Array<number>(total).fill(0)
  const lowerQuery = query.toLowerCase()
  const exactTopic = index.chunks.find((chunk) => chunk.topic.toLowerCase() === lowerQuery.trim())

  for (const term of new Set(queryTerms)) {
    const df = index.documentFrequency[term] ?? 0
    if (df === 0) continue
    // BM25 IDF with the +1 that keeps a term present in every document from scoring 0.
    const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
    for (const chunkIndex of index.postings[term] ?? []) {
      const chunk = index.chunks[chunkIndex]
      const frequency = index.termFrequency[chunk.id]?.[term] ?? 0
      const length = Object.values(index.termFrequency[chunk.id] ?? {}).reduce((a, b) => a + b, 0)
      const norm = index.averageLength === 0 ? 1 : length / index.averageLength
      scores[chunkIndex] += (idf * (frequency * (K1 + 1))) / (frequency + K1 * (1 - B + B * norm))
    }
  }

  if (exactTopic) {
    const boost = scores[index.chunks.indexOf(exactTopic)] ?? 0
    scores[index.chunks.indexOf(exactTopic)] = boost + 6
  }

  // Identifiers a chunk defines outrank a passing mention in its body.
  const definedSomewhere = new Set(index.chunks.flatMap((chunk) => chunk.keywords ?? []))
  const isIdentifierQuery =
    queryTerms.length > 0 && queryTerms.every((term) => definedSomewhere.has(term))
  index.chunks.forEach((chunk, i) => {
    const defines = (chunk.keywords ?? []).some((keyword) => queryTerms.includes(keyword))
    if (defines) {
      scores[i] = (scores[i] ?? 0) + KEYWORD_BOOST
    } else if (isIdentifierQuery) {
      // Every term is an identifier the corpus defines, so this chunk is a false positive
      // that merely mentioned one in prose. Drop it rather than pad the prompt.
      scores[i] = 0
    }
  })

  return index.chunks
    .map((chunk, i) => ({ ...chunk, score: Number((scores[i] ?? 0).toFixed(4)) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}

/** Render retrieved chunks as the "relevant documentation" block of the codegen prompt. */
export function renderContext(chunks: RetrievedChunk[], maxChars = 6_000): string {
  if (chunks.length === 0) return ''
  const blocks: string[] = []
  let used = 0
  for (const chunk of chunks) {
    const header = `### ${chunk.title}\n(source: ${chunk.source})\n`
    const body = `${chunk.text}\n`
    if (used + header.length + body.length > maxChars) break
    blocks.push(header + body)
    used += header.length + body.length
  }
  return blocks.join('\n')
}
