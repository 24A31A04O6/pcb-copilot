import { packageVersion } from '@/lib/server/resolve-package'

/**
 * Exact versions of everything that can change a design, recorded in every export
 * manifest so a board can be reproduced later.
 *
 * Read from the installed packages at runtime — a hard-coded string here would silently
 * drift from the lockfile.
 */

let cache: Record<string, string> | null = null

function versions(): Record<string, string> {
  if (cache) return cache
  cache = {
    '@tscircuit/eval': packageVersion('@tscircuit/eval'),
    '@tscircuit/checks': packageVersion('@tscircuit/checks'),
    'circuit-json': packageVersion('circuit-json'),
    'circuit-json-to-gerber': packageVersion('circuit-json-to-gerber'),
    'circuit-json-to-bom-csv': packageVersion('circuit-json-to-bom-csv'),
    'circuit-json-to-pnp-csv': packageVersion('circuit-json-to-pnp-csv'),
    '@tscircuit/3d-viewer': packageVersion('@tscircuit/3d-viewer'),
    '@tscircuit/pcb-viewer': packageVersion('@tscircuit/pcb-viewer'),
    '@tscircuit/schematic-viewer': packageVersion('@tscircuit/schematic-viewer'),
    node: process.version,
  }
  return cache
}

export const TSCIRCUIT_VERSIONS = {
  get eval() {
    return versions()['@tscircuit/eval']
  },
  get checks() {
    return versions()['@tscircuit/checks']
  },
  get circuitJson() {
    return versions()['circuit-json']
  },
  get gerber() {
    return versions()['circuit-json-to-gerber']
  },
  get bom() {
    return versions()['circuit-json-to-bom-csv']
  },
  get pnp() {
    return versions()['circuit-json-to-pnp-csv']
  },
  get viewer3d() {
    return versions()['@tscircuit/3d-viewer']
  },
  get pcbViewer() {
    return versions()['@tscircuit/pcb-viewer']
  },
  get schematicViewer() {
    return versions()['@tscircuit/schematic-viewer']
  },
  get node() {
    return versions().node
  },
  all() {
    return { ...versions() }
  },
}
