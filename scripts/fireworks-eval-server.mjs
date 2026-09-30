#!/usr/bin/env node
/**
 * fireworks-eval-server.mjs — serves the browser eval harness on the live preview.
 * Zero dependencies. Binds 0.0.0.0 so the Arena preview proxy can reach it.
 *
 *   node scripts/fireworks-eval-server.mjs          # http://0.0.0.0:8790
 *   PORT=9000 node scripts/fireworks-eval-server.mjs
 *
 * Static only — the API key never passes through this server.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8790)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  const file = url === '/' ? 'fireworks-eval.html' : url === '/suite.js' ? 'fireworks-eval-suite.mjs' : null
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }
  try {
    const body = readFileSync(join(DIR, file))
    res.writeHead(200, {
      'Content-Type': MIME[file.endsWith('.html') ? '.html' : '.js'],
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(String(e))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`fireworks-eval harness serving on http://0.0.0.0:${PORT}`)
})
