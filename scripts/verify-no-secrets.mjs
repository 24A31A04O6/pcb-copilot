#!/usr/bin/env node
/**
 * Fails the build if a secret is committed, or if a server-only value has leaked into a
 * file the browser bundle can reach.
 *
 * Two passes, because they catch different mistakes:
 *
 *   1. Shape scan of everything git tracks. Catches a key pasted into a source file, a
 *      fixture or a lockfile entry, whatever the provider or the variable is called.
 *   2. Client-boundary scan. `FIREWORKS_API_KEY` referenced from a component is a mistake
 *      even when the value is the string "undefined": it is the shape a leak takes before
 *      somebody pastes the real value in.
 *
 * Entropy alone produces false positives, so the literal rule is deliberately narrow. Every
 * hit is reported redacted; a scanner that echoes secrets into CI logs is its own leak.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const ROOT = process.cwd()

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out', 'reports',
  '.vercel', '.turbo', 'test-results', 'playwright-report',
])

/** Generated or hash-dense by construction. */
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'])

/** Directories that reach the browser. `lib/server` is deliberately excluded. */
const CLIENT_DIRS = ['app', 'components', 'lib']
const CLIENT_EXCLUDE = /(^|\/)lib\/server(\/|$)/

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.md', '.yml', '.yaml'])

const ENV_EXAMPLES = new Set(['.env.example', '.env.local.example'])

/** Credential shapes unambiguous enough to fail a build on sight. */
const NAMED_CREDENTIALS = [
  { name: 'Fireworks API key', pattern: /\b(?:fw|mcp)_[A-Za-z0-9_-]{16,}\b/g },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'Vercel token', pattern: /\b(?:vercel|vc)_[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Cloudflare API token', pattern: /\bv1\.0-[A-Za-z0-9_-]{20,}-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
]

/** Long opaque runs, surfaced as suggestions for a human rather than as failures. */
const HIGH_ENTROPY_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g

const CLIENT_ONLY_NAME = /(API_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|_TOKEN)$/

/** Shannon entropy in bits per character. English prose sits under 3.6. */
function entropy(value) {
  const counts = new Map()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let total = 0
  for (const count of counts.values()) {
    const p = count / value.length
    total -= p * Math.log2(p)
  }
  return total
}

/**
 * What counts as a credential-looking literal.
 *
 * Two rules retire nearly all prose: a credential has no whitespace, and it mixes letters
 * with digits. The first version keyed on the word "key" appearing anywhere near a long
 * string and flagged four of this repo's own error messages, which is how a scanner gets
 * switched off and never read again.
 */
function looksLikeCredential(value) {
  if (value.length < 24) return false
  if (/\s/.test(value)) return false // prose
  if (value.includes('${')) return false // a template literal, not its value
  // A storage key or a domain is lower-case and dotted. A key mixes cases and has digits.
  // This is what separates `pcb-copilot.fab-preset.v1` from a real credential.
  const hasUpper = /[A-Z]/.test(value)
  const hasLower = /[a-z]/.test(value)
  const hasDigit = /[0-9]/.test(value)
  if (!hasUpper || !hasLower || !hasDigit) return false
  return entropy(value) >= 3.6
}

/** Never print more than the first four characters of anything that might be a credential. */
function redact(value) {
  return `${value.slice(0, 4)}... (${value.length} chars, ${entropy(value).toFixed(2)} bits/char)`
}

/**
 * Remove comments before scanning for literals.
 *
 * Half the first run's findings were documentation: "reads `pcb_board.solder_mask_color`
 * from `@tscircuit/3d-viewer@0.0.598`" is a sentence, not a credential. Comment stripping
 * is string-aware, because a naive regex turns the `https://` in a playground URL into the
 * start of a line comment and deletes the rest of the file.
 */
function stripComments(text) {
  let out = ''
  let i = 0
  let quote = null
  while (i < text.length) {
    const char = text[i]
    if (quote) {
      out += char
      if (char === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (char === quote) quote = null
      i += 1
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out += char
      i += 1
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += char
    i += 1
  }
  return out
}

const findings = []

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(join(dir, entry.name))
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue
      if (!EXTENSIONS.has(extname(entry.name))) continue
      yield join(dir, entry.name)
    }
  }
}

function readOrNull(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function scanCredentialShapes() {
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file)
    const text = readOrNull(file)
    if (text === null) continue
    // The example env file documents the shape of a key. Documenting a prefix is not
    // leaking one; a full-length value in it would be, and the shape scan would still see it.
    if (ENV_EXAMPLES.has(rel)) continue
    const code = stripComments(text)
    for (const { name, pattern } of NAMED_CREDENTIALS) {
      for (const match of code.matchAll(pattern)) {
        findings.push({ file: rel, rule: name, detail: redact(match[0]) })
      }
    }
  }
}

function scanClientBoundary() {
  for (const dir of CLIENT_DIRS) {
    const root = join(ROOT, dir)
    try {
      statSync(root)
    } catch {
      continue
    }
    for (const file of walk(root)) {
      const rel = relative(ROOT, file)
      if (CLIENT_EXCLUDE.test(rel)) continue
      const text = readOrNull(file)
      if (text === null) continue
      stripComments(text).split('\n').forEach((line, index) => {
        if (/NEXT_PUBLIC_[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD)/.test(line)) {
          findings.push({
            file: rel,
            rule: 'NEXT_PUBLIC secret name',
            detail: `line ${index + 1}: ${line.trim().slice(0, 80)}`,
          })
        }
        // Next.js substitutes `process.env.SECRET` with the literal "undefined" in a client
        // bundle, so this is a build-time break rather than a runtime leak. It is still
        // always a mistake, and it is the shape a leak takes before a value is pasted in.
        const envRead = line.match(/process\.env\.([A-Z_][A-Z0-9_]*)/)?.[1]
        if (envRead && CLIENT_ONLY_NAME.test(envRead) && !envRead.startsWith('NEXT_PUBLIC_')) {
          findings.push({
            file: rel,
            rule: 'server-only env read in client code',
            detail: `line ${index + 1}: process.env.${envRead}`,
          })
        }
        for (const quoted of line.match(/['"`]([^'"`\n]{16,})['"`]/g) ?? []) {
          const value = quoted.slice(1, -1)
          if (looksLikeCredential(value)) {
            findings.push({
              file: rel,
              rule: 'credential-looking literal in client code',
              detail: `line ${index + 1}: ${redact(value)}`,
            })
          }
        }
      })
    }
  }
}

function scanTrackedEnvFiles() {
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    // Plain `ls-files`, not `--error-unmatch`: an untracked file must be a clean pass
    // rather than a thrown error.
    const tracked = execFileSync('git', ['ls-files', '--', name], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (tracked.trim()) {
      findings.push({
        file: name,
        rule: 'env file is tracked by git',
        detail: 'untrack it; commit .env.example instead',
      })
    }
  }
}

scanCredentialShapes()
scanClientBoundary()
scanTrackedEnvFiles()

if (findings.length > 0) {
  console.error(`\nverify-no-secrets: ${findings.length} finding(s)\n`)
  for (const finding of findings) {
    console.error(`  ${finding.file}  [${finding.rule}]`)
    console.error(`      ${finding.detail}`)
  }
  console.error('\nNo full value is printed above, on purpose.\n')
  process.exit(1)
}

const candidates = execFileSync(
  'git',
  ['grep', '-hoE', HIGH_ENTROPY_RUN.source, '--', 'app', 'components', 'lib', 'scripts'],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
)
  .split('\n')
  .filter((value) => value.length >= 40 && entropy(value) > 4.2)
  .filter((value) => !/^[0-9a-f]{40,}$/.test(value)) // hashes are not credentials

console.log(
  'verify-no-secrets: no credentials found' +
    (candidates.length > 0
      ? `; ${candidates.length} high-entropy string(s) worth a human look (not failures).`
      : '.'),
)
