import '@/lib/server/only'

import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AppError } from '@/lib/errors'
import { resolvePackageEntry } from '@/lib/server/resolve-package'

import { SANDBOX_WORKER_SOURCE } from './worker-source'

/**
 * Runs LLM-generated tscircuit source in an isolated, capped child process.
 *
 * Nothing from the model is ever evaluated in the request thread.
 */

const TS_PACKAGE_NAMES = { eval: '@tscircuit/eval', checks: '@tscircuit/checks' } as const

const SOURCE_ALLOWED_PREFIXES = ['@tscircuit/', '@tsci/', 'circuit-json', 'react', 'react-dom']

export type SandboxResult = {
  circuitJson: unknown[]
  checks: unknown[]
  durationMs: number
}

export type SandboxOptions = {
  timeoutMs: number
  memoryMb: number
  maxElements: number
  signal?: AbortSignal
  onStderr?: (chunk: string) => void
}

let workerPath: string | null = null
let modulePaths: { evalPath: string; checksPath: string } | null = null

function ensureWorkerFile(): string {
  if (workerPath) return workerPath
  const hash = createHash('sha256').update(SANDBOX_WORKER_SOURCE).digest('hex').slice(0, 12)
  const dir = join(tmpdir(), 'pcb-copilot-sandbox')
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, `compile-${hash}.mjs`)
    writeFileSync(file, SANDBOX_WORKER_SOURCE, { mode: 0o600 })
    workerPath = file
    return file
  } catch (error) {
    throw new AppError('COMPILE_FAILED', {
      cause: error,
      internal: `Could not write the compile sandbox to ${dir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  }
}

/**
 * Package entry points, resolved by Node at runtime rather than by the bundler.
 * See `lib/server/resolve-package.ts` for why this is deliberately opaque.
 */
function resolveModulePaths(): { evalPath: string; checksPath: string } {
  if (modulePaths) return modulePaths
  try {
    modulePaths = {
      evalPath: resolvePackageEntry(TS_PACKAGE_NAMES.eval),
      checksPath: resolvePackageEntry(TS_PACKAGE_NAMES.checks),
    }
  } catch (error) {
    throw new AppError('COMPILE_FAILED', {
      cause: error,
      internal: `Could not resolve the tscircuit toolchain: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  }
  return modulePaths
}

/**
 * Static validation of generated source, run in the parent before anything is forked.
 *
 * This is an allow-list, not a deny-list: the module may only contain JSX for known
 * tscircuit elements plus plain JavaScript. `tscircuit/eval` transpiles with Sucrase and
 * evaluates with `new Function`, so `--disallow-code-generation-from-strings` cannot be
 * used (it would break the compiler itself) — this check plus the process boundary is the
 * mitigation. See docs/DECISIONS.md §3.
 */
export function assertSafeGeneratedCode(code: string): void {
  if (code.length > 60_000) {
    throw new AppError('COMPILE_FAILED', { internal: 'Generated source exceeded 60k characters.' })
  }
  if (code.includes('\u0000')) {
    throw new AppError('COMPILE_FAILED', { internal: 'Generated source contains a NUL byte.' })
  }
  if (code.length > 0 && code.charCodeAt(0) === 0xfeff) {
    throw new AppError('COMPILE_FAILED', { internal: 'Generated source starts with a BOM.' })
  }
  if (!/export\s+default\s/.test(code)) {
    throw new AppError('COMPILE_FAILED', {
      internal: 'Generated source must export a default circuit component.',
    })
  }

  // Scan a comment-free copy so a note in a comment cannot trip a rule (or smuggle a
  // pattern past a naive reader). String literals are left alone on purpose.
  const scan = stripComments(code)

  const forbidden: Array<[RegExp, string]> = [
    [/\bimport\b\s*[A-Za-z_{*(]/, 'import statements are not allowed'],
    [/\bexport\s+(?!\s*default\b)/, 're-exports are not allowed'],
    [/\brequire\s*\(/, 'require() is not allowed'],
    [/\beval\s*\(/, 'eval() is not allowed'],
    [/\bnew\s+Function\s*\(/, 'new Function() is not allowed'],
    [/\bFunction\s*\(\s*['"`]/, 'Function constructor is not allowed'],
    [/\bprocess\b/, 'process access is not allowed'],
    [/\bglobalThis\b/, 'globalThis access is not allowed'],
    [/\bwindow\b|\bdocument\b|\blocalStorage\b/, 'DOM access is not allowed'],
    [/\bfetch\s*\(/, 'fetch() is not allowed'],
    [/\bWebSocket\b|\bXMLHttpRequest\b|\bEventSource\b/, 'network APIs are not allowed'],
    [/\bsetTimeout\s*\(|\bsetInterval\s*\(|\brequestAnimationFrame\s*\(/, 'timers are not allowed'],
    [/\bwhile\s*\(\s*true\s*\)/, 'unbounded loop is not allowed'],
    [/\bfor\s*\(\s*;\s*;\s*\)/, 'unbounded loop is not allowed'],
    [/\b__proto__\b|\bconstructor\s*\[/, 'prototype access is not allowed'],
    [/\bBuffer\b/, 'Buffer is not allowed'],
    [/\bimport\s*\.\s*meta\b/, 'import.meta is not allowed'],
    [/\bwith\s*\(/, 'with() is not allowed'],
    [/\bdebugger\b/, 'debugger is not allowed'],
  ]

  for (const [pattern, message] of forbidden) {
    if (pattern.test(scan)) {
      throw new AppError('COMPILE_FAILED', { internal: `Generated source rejected: ${message}.` })
    }
  }

  // Allow-listed import specifiers, if the model emitted any comment or string form.
  const importSpecifiers = scan.match(/(?:from|import)\s+["']([^"']+)["']/g) ?? []
  for (const raw of importSpecifiers) {
    const specifier = raw.replace(/(?:from|import)\s+["']/, '').replace(/["']$/, '')
    if (!SOURCE_ALLOWED_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
      throw new AppError('COMPILE_FAILED', {
        internal: `Generated source imports "${specifier}", which is not in the allow-list.`,
      })
    }
  }

  for (const line of code.split('\n')) {
    if (line.length > 2_000) {
      throw new AppError('COMPILE_FAILED', {
        internal: 'Generated source contains an excessively long line.',
      })
    }
  }
}

/** Remove `//` and block comments so a rule never fires on prose. */
export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function classify(childError: { name: string; message: string }): AppError {
  const message = childError.message ?? ''
  if (message.startsWith('compile_timeout')) {
    return new AppError('COMPILE_FAILED', { internal: `Circuit compilation timed out. ${message}` })
  }
  if (message.startsWith('circuit_too_large')) {
    return new AppError('COMPILE_FAILED', { internal: message })
  }
  return new AppError('COMPILE_FAILED', {
    internal: `${childError.name}: ${message}`.slice(0, 2_000),
  })
}

export async function runInSandbox(code: string, options: SandboxOptions): Promise<SandboxResult> {
  assertSafeGeneratedCode(code)

  const file = ensureWorkerFile()
  const { evalPath, checksPath } = resolveModulePaths()
  const timeoutMs = Math.max(2_000, options.timeoutMs)

  return new Promise<SandboxResult>((resolve, reject) => {
    let settled = false
    let stderr = ''
    let child: ChildProcess

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', onAbort)
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      fn()
    }

    const killTimer = setTimeout(() => {
      finish(() =>
        reject(
          new AppError('COMPILE_FAILED', {
            internal: `Compile sandbox exceeded its ${timeoutMs}ms wall clock and was killed.`,
          }),
        ),
      )
    }, timeoutMs + 2_000)

    const onAbort = () => {
      finish(() => reject(new AppError('COMPILE_FAILED', { internal: 'Compile aborted by client.' })))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      // `spawn` rather than `fork`: the bundler special-cases `fork`'s first argument and
      // tries to resolve it as a build-time module, which cannot work for a path that is
      // only known at run time. `spawn` with an `ipc` stdio entry has identical semantics.
      child = spawn(process.execPath, ['--max-old-space-size=' + String(options.memoryMb), '--no-warnings', file], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'json',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: tmpdir(),
          NODE_ENV: 'production',
          __PCB_SANDBOX__: JSON.stringify({
            code,
            evalPath,
            checksPath,
            timeoutMs,
            maxElements: options.maxElements,
          }),
        },
        detached: false,
      })
    } catch (error) {
      finish(() =>
        reject(
          new AppError('COMPILE_FAILED', {
            cause: error,
            internal: `Could not start the compile sandbox: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }),
        ),
      )
      return
    }

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000)
      options.onStderr?.(chunk)
    })

    child.on('message', (message: unknown) => {
      const payload = message as
        | { ok: true; circuitJson: unknown[]; checks: unknown[]; durationMs: number }
        | { ok: false; error: { name: string; message: string }; durationMs: number }
      if (!payload || typeof payload !== 'object') return
      if (payload.ok) {
        finish(() =>
          resolve({
            circuitJson: payload.circuitJson,
            checks: payload.checks ?? [],
            durationMs: payload.durationMs,
          }),
        )
      } else {
        finish(() => reject(classify(payload.error)))
      }
    })

    child.on('error', (error) => {
      finish(() =>
        reject(
          new AppError('COMPILE_FAILED', {
            cause: error,
            internal: `Compile sandbox failed to start: ${error.message}${stderr ? `\n${stderr.slice(-500)}` : ''}`,
          }),
        ),
      )
    })

    child.on('exit', (code, signal) => {
      finish(() => {
        if (signal) {
          reject(
            new AppError('COMPILE_FAILED', {
              internal: `Compile sandbox was killed (${signal}). Memory cap: ${options.memoryMb} MB.`,
            }),
          )
        } else {
          reject(
            new AppError('COMPILE_FAILED', {
              internal: `Compile sandbox exited early with code ${code}.${stderr ? `\n${stderr.slice(-500)}` : ''}`,
            }),
          )
        }
      })
    })
  })
}

/** Test seam: forget the memoised worker path and resolved module paths. */
export function __resetSandbox(): void {
  workerPath = null
  modulePaths = null
}
