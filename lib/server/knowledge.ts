import '@/lib/server/only'

import indexJson from './knowledge-index.json'
import { renderContext, retrieve, type KnowledgeIndex, type RetrievedChunk } from '@/lib/retrieval'

/**
 * Grounding for the code generator.
 *
 * The index is a build artefact produced by `pnpm run knowledge:build` from the installed
 * `@tscircuit/props` source, so the API reference in the prompt is the API the compiler in
 * this deployment actually has. Retrieval is BM25 over 150-odd short chunks: no model call,
 * no vector store, no network, and a handful of milliseconds.
 *
 * If the index is missing or malformed the pipeline still runs — it just sends the prompt
 * without the reference. That is a degraded design, never a crash, and never a reason to
 * invent an API.
 */

let cached: KnowledgeIndex | null = null

function load(): KnowledgeIndex | null {
  if (cached) return cached
  try {
    const candidate = indexJson as unknown as KnowledgeIndex
    if (!candidate || !Array.isArray(candidate.chunks) || candidate.chunks.length === 0) return null
    if (typeof candidate.averageLength !== 'number' || !candidate.postings) return null
    cached = candidate
    return cached
  } catch {
    return null
  }
}

/** Top chunks for a query. Returns an empty array rather than throwing. */
export function knowledgeFor(query: string, limit = 6): RetrievedChunk[] {
  const index = load()
  if (!index) return []
  try {
    return retrieve(index, query, limit)
  } catch {
    return []
  }
}

/** The reference block injected into the code-generation prompt, or '' when unavailable. */
export function knowledgeContext(query: string, maxChars = 6_000): string {
  const chunks = knowledgeFor(query, 8)
  if (chunks.length === 0) return ''
  return [
    'The following is the API reference for the exact tscircuit version installed on this',
    'server. Use these prop names and types verbatim; do not invent alternatives.',
    '',
    renderContext(chunks, maxChars),
  ].join('\n')
}

export function knowledgeStats(): { chunks: number; terms: number; version: string } | null {
  const index = load()
  if (!index) return null
  return {
    chunks: index.chunks.length,
    terms: Object.keys(index.documentFrequency).length,
    version: index.builtFrom.version,
  }
}

/** Test seam. */
export function __resetKnowledge(): void {
  cached = null
}
