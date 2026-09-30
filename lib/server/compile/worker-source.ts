/**
 * Source of the compile sandbox child process.
 *
 * It is written to a temp file at runtime and spawned, rather than shipped as a bundled
 * asset, because the worker has to `import()` @tscircuit/eval by *absolute path*. The
 * parent resolves those paths with its own fs-only resolver, so the sandbox keeps working
 * whether the app runs from `node_modules`, from a Next.js server bundle, or from a
 * standalone Vercel lambda.
 *
 * Isolation model (docs/DECISIONS.md §3):
 *   - a separate OS process with a hard wall-clock kill, so a runaway loop cannot hold
 *     the request thread and one crash cannot blank the app
 *   - a V8 old-space cap via --max-old-space-size: a runaway allocation OOM-kills *that*
 *     process and nothing else
 *   - `fetch`/`WebSocket`/`XMLHttpRequest` are replaced with throwing stubs before any
 *     circuit package is loaded, and tscircuit's own `platformFetch` is stubbed out so the
 *     parts engine cannot reach EasyEda/ModelCDN
 *   - npm-package imports are rejected (`disableCdnLoading`), so the generated module can
 *     never pull code from a CDN at run time
 *   - the import allow-list is enforced in the parent, before the process is started
 */
export const SANDBOX_WORKER_SOURCE = `\
// pcb-copilot compile sandbox — generated, do not edit on disk.
import { pathToFileURL } from 'node:url'

const refuse = (what) => () => {
  throw new Error('sandbox: ' + what + ' is not available inside the compile sandbox')
}

// Lock the sandbox down BEFORE loading any circuit package.
for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator']) {
  try { globalThis[name] = refuse(name) } catch {}
}

const startedAt = Date.now()
const send = (payload) => {
  try { process.send(payload) } catch {}
}

async function main() {
  let payload
  try {
    payload = JSON.parse(process.env.__PCB_SANDBOX__ || '')
  } catch {
    throw new Error('sandbox: __PCB_SANDBOX__ was not valid JSON')
  }
  const { code, evalPath, checksPath, timeoutMs, maxElements } = payload

  if (!code) throw new Error('sandbox: no code supplied')
  if (!evalPath || !checksPath) throw new Error('sandbox: toolchain paths were not supplied')

  const evalMod = await import(pathToFileURL(evalPath).href)
  const checksMod = await import(pathToFileURL(checksPath).href)
  const { CircuitRunner } = evalMod
  const { runAllChecks } = checksMod

  const runner = new CircuitRunner({
    disableCdnLoading: true,
    verbose: false,
    platform: {
      platformFetch: async () => {
        throw new Error('sandbox: network access is disabled')
      },
    },
  })

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('compile_timeout: exceeded ' + timeoutMs + 'ms inside the sandbox')),
      timeoutMs,
    )
    if (typeof timer.unref === 'function') timer.unref()
  })

  try {
    const work = (async () => {
      // \`execute()\` treats the code as a bare entrypoint and expects the file itself to call
      // \`circuit.add(...)\`. \`executeWithFsMap\` with a single \`index.tsx\` is the documented
      // path for user code: it wraps the default export in \`circuit.add(<Default />)\` for us.
      await runner.executeWithFsMap({ fsMap: { 'index.tsx': code } })
      await runner.renderUntilSettled()
      const circuitJson = await runner.getCircuitJson()
      if (!Array.isArray(circuitJson)) {
        throw new Error('Compiler did not return a circuit JSON array')
      }
      if (circuitJson.length > maxElements) {
        throw new Error(
          'circuit_too_large: ' + circuitJson.length + ' elements exceeds the limit of ' + maxElements,
        )
      }
      const checks = await runAllChecks(circuitJson)
      try { await runner.kill() } catch {}
      return { circuitJson, checks }
    })()

    const result = await Promise.race([work, timeout])
    send({ ok: true, ...result, durationMs: Date.now() - startedAt })
  } finally {
    clearTimeout(timer)
    // Exit promptly: tscircuit leaves timers and worker handles behind.
    setTimeout(() => process.exit(0), 10).unref?.()
  }
}

main().catch((error) => {
  send({
    ok: false,
    error: {
      name: (error && error.name) || 'Error',
      message: String((error && error.message) || error).slice(0, 4000),
    },
    durationMs: Date.now() - startedAt,
  })
  setTimeout(() => process.exit(0), 10).unref?.()
})

process.on('uncaughtException', (error) => {
  send({ ok: false, error: { name: 'UncaughtException', message: String(error && error.message) } })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  send({ ok: false, error: { name: 'UnhandledRejection', message: String(reason && reason.message || reason) } })
  process.exit(1)
})
`
