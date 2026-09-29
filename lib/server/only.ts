/**
 * Server-only guard.
 *
 * `import 'server-only'` is the idiomatic Next.js way to make an accidental client import a
 * build error, but the package only resolves inside the Next toolchain — Node, tsx and
 * Vitest all fail to load it. This module is the same guard with no resolution magic: it
 * throws on import in any environment that has a DOM, and is an inert module on the server.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'This module is server-only. Move the import into a route handler, server action or other server module.',
  )
}
