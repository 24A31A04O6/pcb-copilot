import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runtime package resolution, done with `fs` only.
 *
 * Every tscircuit package is listed in `serverExternalPackages`, so the bundler must not
 * inline them. Turbopack nevertheless statically analyses `createRequire(...).resolve(x)`
 * and `require(x + '/package.json')` and fails the build with "Module not found", so this
 * module deliberately resolves the files itself.
 *
 * Doing it by hand also means the compile sandbox finds the same packages in `next dev`,
 * `next start`, and a standalone Vercel lambda, where the traced `node_modules` sit next
 * to the server bundle rather than at the project root.
 */

type PackageManifest = {
  name?: string
  version?: string
  main?: string
  module?: string
  exports?: unknown
}

const candidates: Array<() => string> = [
  () => (typeof import.meta.url === 'string' ? dirname(fileURLToPath(import.meta.url)) : ''),
  () => process.cwd(),
]

function findPackageDir(packageName: string): string | null {
  for (const candidate of candidates) {
    let dir: string
    try {
      dir = candidate()
    } catch {
      continue
    }
    if (!dir) continue
    for (let depth = 0; depth < 12; depth += 1) {
      const manifest = join(dir, 'node_modules', packageName, 'package.json')
      try {
        readFileSync(manifest)
        return join(dir, 'node_modules', packageName)
      } catch {
        /* keep walking up */
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

function pickExport(manifest: PackageManifest): string | null {
  const exportsField = manifest.exports
  if (typeof exportsField === 'string') return exportsField
  if (!exportsField || typeof exportsField !== 'object') return null

  const record = exportsField as Record<string, unknown>

  const fromSubpath = (key: string): string | null => {
    const value = record[key]
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object') return null
    const conditions = value as Record<string, unknown>
    for (const condition of ['import', 'module', 'node', 'require', 'default']) {
      const resolved = conditions[condition]
      if (typeof resolved === 'string') return resolved
    }
    return null
  }

  return fromSubpath('.') ?? fromSubpath('./package.json') ?? null
}

/** Absolute path to a package's main entry file, resolved from disk. */
export function resolvePackageEntry(packageName: string): string {
  const dir = findPackageDir(packageName)
  if (!dir) throw new Error(`Cannot locate node_modules/${packageName} from ${process.cwd()}`)
  const manifest = JSON.parse(
    readFileSync(join(dir, 'package.json'), 'utf8'),
  ) as PackageManifest

  const target = pickExport(manifest) ?? manifest.module ?? manifest.main ?? 'index.js'
  const entry = resolvePath(dir, target)
  return entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.cjs')
    ? entry
    : join(entry, 'index.js')
}

/**
 * Absolute path to an installed package's root directory, or null when it is absent.
 *
 * Falls back to pnpm's virtual store: a package that is only a transitive dependency (or
 * whose peers resolve to a different variant) is not linked at the project root, but the
 * real directory still exists under `node_modules/.pnpm/<name>@<version>_<peers>/…`.
 */
export function resolvePackageDir(packageName: string): string | null {
  const direct = findPackageDir(packageName)
  if (direct) return direct
  return findInVirtualStore(packageName)
}

function findInVirtualStore(packageName: string): string | null {
  const flatName = packageName.replace('/', '+')
  for (const root of candidates) {
    if (!root()) continue
    let dir = root()
    for (let depth = 0; depth < 12; depth += 1) {
      const store = join(dir, 'node_modules', '.pnpm')
      let entries: string[]
      try {
        entries = readdirSync(store)
      } catch {
        entries = []
      }
      for (const entry of entries) {
        if (!entry.startsWith(`${flatName}@`)) continue
        const candidate = join(store, entry, 'node_modules', packageName)
        try {
          readFileSync(join(candidate, 'package.json'))
          return candidate
        } catch {
          /* keep looking */
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

/** Version string from an installed package's manifest, or 'unknown'. */
export function packageVersion(packageName: string): string {
  try {
    const dir = resolvePackageDir(packageName)
    if (!dir) return 'unknown'
    const manifest = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    ) as PackageManifest
    return manifest.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
