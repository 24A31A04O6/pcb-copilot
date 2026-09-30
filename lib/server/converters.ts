import '@/lib/server/only'

/**
 * Lazy access to the fabrication converters.
 *
 * All three packages are published as ESM ("type": "module") but pull in CommonJS
 * dependencies that `require()` `@tscircuit/math-utils`, whose `exports` map only declares
 * an `import` condition. A static import in this app is transpiled to `require()` by some
 * server loaders, which then fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Going through
 * `import()` keeps every load on the ESM resolver, where the `import` condition matches.
 *
 * See docs/DECISIONS.md — "Converters are loaded through import(), not require()".
 */
import type { convertCircuitJsonToBomRows as BomRowsFn } from 'circuit-json-to-bom-csv'
import type { convertBomRowsToCsv as BomCsvFn } from 'circuit-json-to-bom-csv'
import type { convertCircuitJsonToGerberFiles as GerberFn } from 'circuit-json-to-gerber'
import type { convertCircuitJsonToPickAndPlaceCsv as PnpFn } from 'circuit-json-to-pnp-csv'

export type Converters = {
  convertCircuitJsonToGerberFiles: typeof GerberFn
  convertCircuitJsonToBomRows: typeof BomRowsFn
  convertBomRowsToCsv: typeof BomCsvFn
  convertCircuitJsonToPickAndPlaceCsv: typeof PnpFn
}

let cached: Promise<Converters> | null = null

/**
 * The module instances are cached for the life of the process: the converters are pure and
 * hold no per-design state, and re-importing them on every request would add measurable
 * latency to a cold lambda.
 */
export function loadConverters(): Promise<Converters> {
  cached ??= (async () => {
    const [gerber, bom, pnp] = await Promise.all([
      import('circuit-json-to-gerber'),
      import('circuit-json-to-bom-csv'),
      import('circuit-json-to-pnp-csv'),
    ])
    return {
      convertCircuitJsonToGerberFiles: gerber.convertCircuitJsonToGerberFiles,
      convertCircuitJsonToBomRows: bom.convertCircuitJsonToBomRows,
      convertBomRowsToCsv: bom.convertBomRowsToCsv,
      convertCircuitJsonToPickAndPlaceCsv: pnp.convertCircuitJsonToPickAndPlaceCsv,
    }
  })().catch((error: unknown) => {
    // Do not memoise a failure: a transient resolution error should not poison the process.
    cached = null
    throw error
  })
  return cached
}

/** Test seam: drop the memoised module instances. */
export function __resetConverters(): void {
  cached = null
}
