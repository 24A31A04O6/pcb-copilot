/**
 * Build the retrieval index the code generator is grounded on.
 *
 * The bulk of the corpus is generated from the *installed* `@tscircuit/props` source: each
 * `lib/components/*.ts` file declares one element's props with doc comments and types. Those
 * are the exact props the installed compiler accepts, so the prompt cannot teach the model
 * an API that does not exist. A small set of hand-written notes in `docs/knowledge` covers
 * the things a props file cannot say — routing, decoupling, fab rules, footprinter strings.
 *
 * Output: `lib/server/knowledge-index.json`. Run with `pnpm run knowledge:build`.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { buildIndex, type KnowledgeChunk } from '@/lib/retrieval'
import { packageVersion, resolvePackageDir } from '@/lib/server/resolve-package'

const PROPS_PACKAGE = '@tscircuit/props'
const NOTES_DIR = join(process.cwd(), 'docs', 'knowledge')
const OUT = join(process.cwd(), 'lib', 'server', 'knowledge-index.json')

/** `<pinheader>`, `<resistor>` … lowercased, as the topic and as the JSX element name. */
function elementName(file: string): string {
  return basename(file, '.ts').toLowerCase().replace(/-/g, '')
}

type Prop = { name: string; type: string; doc: string }

function extractProps(source: string): Prop[] {
  const props: Prop[] = []
  // Walk the file once, tracking the most recent `/** … */` block so each property can be
  // attributed to the comment that documents it.
  const pattern = /\/\*\*([\s\S]*?)\*\/\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([^;\n]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const doc = match[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*?\s?/, '').trimEnd())
      .filter((line) => line.length > 0 && !line.startsWith('@'))
      .join(' ')
      .trim()
    props.push({ name: match[2], type: match[3].replace(/\s+/g, ' ').trim(), doc })
  }
  return props
}

function elementChunk(file: string, source: string): KnowledgeChunk {
  const name = elementName(file)
  const props = extractProps(source)
  const lines: string[] = []

  const summary = source.match(/@tscircuit[^\n]*/)
  if (summary) lines.push(summary[0].replace(/\s+/g, ' ').trim())

  if (props.length === 0) {
    lines.push(source.replace(/\s+/g, ' ').trim().slice(0, 1_200))
  } else {
    for (const prop of props) {
      const optional = source.includes(`${prop.name}?:`) ? '?' : ''
      lines.push(`- \`${prop.name}${optional}: ${prop.type}\`${prop.doc ? ` — ${prop.doc}` : ''}`)
    }
  }

  return {
    id: `props:${name}`,
    topic: name,
    title: `<${name}>`,
    text: lines.join('\n'),
    source: `${PROPS_PACKAGE}/lib/components/${basename(file)}`,
    // The element name and the props it declares: a query naming one of these is asking
    // about this element, even if several other components also accept the prop.
    keywords: [name, ...props.map((prop) => prop.name.toLowerCase())],
  }
}

function commonChunks(): KnowledgeChunk[] {
  const dir = resolvePackageDir(PROPS_PACKAGE)
  if (!dir) return []
  const commonDir = join(dir, 'lib', 'common')
  if (!existsSync(commonDir)) return []
  return readdirSync(commonDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const source = readFileSync(join(commonDir, file), 'utf8')
      const topic = basename(file, '.ts').toLowerCase().replace(/-/g, '')
      const props = extractProps(source)
      const body = props.length
        ? props.map((p) => `- \`${p.name}\`${p.doc ? ` — ${p.doc}` : ''}`).join('\n')
        : source.replace(/\s+/g, ' ').trim().slice(0, 800)
      return {
        id: `common:${topic}`,
        topic,
        title: `Common props: ${topic}`,
        text: body,
        source: `${PROPS_PACKAGE}/lib/common/${file}`,
        keywords: props.map((prop) => prop.name.toLowerCase()),
      }
    })
}

function noteChunks(): KnowledgeChunk[] {
  if (!existsSync(NOTES_DIR)) return []
  return readdirSync(NOTES_DIR)
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) => {
      const raw = readFileSync(join(NOTES_DIR, file), 'utf8')
      const frontMatter = raw.match(/^---\n([\s\S]*?)\n---\n?/)
      const meta = frontMatter?.[1] ?? ''
      const topic = meta.match(/^topic:\s*(.+)$/m)?.[1]?.trim() ?? basename(file, '.md')
      const title = meta.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? topic
      const body = (frontMatter ? raw.slice(frontMatter[0].length) : raw).trim()
      // Split on `## ` so one note can contribute several focused chunks.
      // Split *before* each `## ` so every section keeps its heading.
      const sections = body.split(/(?=^## )/m).filter((section) => section.trim().length > 0)
      return sections.map((section, index) => {
        const heading = section.match(/^##\s+(.+)$/m)?.[1]?.trim()
        // Backticked identifiers in a note (`solderMaskColor`, `0603`) are the terms it is
        // authoritative for, exactly as a props file's property list is.
        const identifiers = [...section.matchAll(/`([A-Za-z_][\w.-]{2,})`/g)].map((m) => m[1].toLowerCase())
        return {
          id: `note:${topic}:${index}`,
          topic,
          // Sections of one note share a topic, so the heading goes in the title: otherwise
          // three chunks of "Checks and fabrication rules" are indistinguishable in a prompt.
          title: heading ? `${title} — ${heading}` : title,
          text: section.replace(/^##\s+.*$/m, '').trim(),
          source: `docs/knowledge/${file}`,
          keywords: [topic, ...new Set(identifiers)],
        }
      })
    })
}

function main(): void {
  const dir = resolvePackageDir(PROPS_PACKAGE)
  if (!dir) {
    throw new Error(`${PROPS_PACKAGE} is not installed; cannot build the knowledge index.`)
  }
  const componentsDir = join(dir, 'lib', 'components')
  if (!existsSync(componentsDir)) {
    throw new Error(`${PROPS_PACKAGE}/lib/components is missing; the package layout changed.`)
  }

  const elementChunks = readdirSync(componentsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => elementChunk(file, readFileSync(join(componentsDir, file), 'utf8')))

  const chunks = [...elementChunks, ...commonChunks(), ...noteChunks()]
  const version = packageVersion(PROPS_PACKAGE)
  const index = buildIndex(chunks, version)

  writeFileSync(OUT, `${JSON.stringify(index, null, 0)}\n`)
  const bytes = readFileSync(OUT).byteLength
  console.log(
    `wrote ${OUT}\n  ${chunks.length} chunks from ${PROPS_PACKAGE}@${version}\n  ${Object.keys(index.documentFrequency).length} terms, ${bytes} bytes`,
  )
  const topics = new Set(chunks.map((chunk) => chunk.topic))
  console.log(`  topics: ${[...topics].sort().join(', ')}`)
}

main()
