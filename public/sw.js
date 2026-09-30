/*
 * pcb-copilot service worker.
 *
 * The scope of the offline story is deliberately small, because a design tool that
 * silently serves a stale brief is worse than one that says it is offline.
 *
 *   - The app shell (HTML, JS, CSS, icons) is precached and served cache-first, so the
 *     page opens instantly and survives a dropped connection.
 *   - Navigations fall back to the cached shell when the network is gone.
 *   - Every API route is network-only, and a failure there is reported as a real error.
 *     Caching a design, a health check or an export would be a correctness bug, not a
 *     performance win: a stale fabrication file sent to a fab is a scrapped board.
 *
 * There is no `skipWaiting` on install. A worker that takes over mid-generation would
 * swap the JavaScript out from under an in-flight design run; the new worker waits until
 * every tab is closed, which is the same rule the update prompt is built around.
 */

const VERSION = 'pcb-copilot-v3'
const SHELL = `${VERSION}-shell`

const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
  '/og.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually, so one 404 does not leave the whole shell uncached.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting === undefined),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache the API. A stale design, health check or export is a correctness bug.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL)
        const cached = await cache.match('/')
        return (
          cached ??
          new Response('<h1>pcb-copilot is offline</h1>', {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        )
      }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          void caches.open(SHELL).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})

// The page asks for a skip when the user accepts an update.
self.addEventListener('message', (event) => {
  if (event.data === 'pcb-copilot:update') void self.skipWaiting()
})
