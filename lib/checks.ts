import { getFabPreset, type FabPreset } from '@/lib/server/checks/fab-presets'

/** A single finding. Severity drives the fabrication gate. */
export type Check = {
  severity: 'error' | 'warning'
  /** Stable machine code, e.g. `unconnected_port`. Safe to switch on. */
  code: string
  message: string
  /** Source element the finding is anchored to, when known. */
  elementId?: string
  /** Component names involved, when known. */
  components?: string[]
  /** Location on the board in mm, when known, so the UI can highlight it. */
  location?: { x: number; y: number }
  /** Fab-preset rule that produced this finding, when applicable. */
  rule?: string
}

export type CheckReport = {
  checks: Check[]
  blockingCount: number
  warningCount: number
  passed: boolean
  fabPresetId: string
  fabPresetLabel: string
  stats: DesignStats
}

export type DesignStats = {
  components: number
  sourceTraces: number
  routedTraces: number
  pcbLayers: number
  boardWidthMm: number | null
  boardHeightMm: number | null
  boardThicknessMm: number | null
  solderMaskColor: string | null
  silkscreenColor: string | null
  nets: number
  vias: number
  holes: number
  elementCount: number
}

type AnyElement = Record<string, unknown>

/** tscircuit's own error/warning elements, plus the output of @tscircuit/checks. */
const BLOCKING_SUFFIXES = [
  '_error',
  'pcb_autorouting_error',
  'pcb_trace_missing_error',
  'pcb_port_not_connected_error',
  'source_pin_must_be_connected_error',
  'pcb_component_outside_board_error',
  'pcb_pad_pad_clearance_error',
  'pcb_courtyard_overlap_error',
  'pcb_trace_via_clearance_error',
  'pcb_via_clearance_error',
  'pcb_pad_trace_clearance_error',
  'pcb_placement_error',
  'pcb_component_misconfigured_error',
]

const ALLOWED_WARNING_TYPES = new Set([
  'pcb_trace_too_long_warning',
  'pcb_component_missing_courtyard_warning',
  'pcb_connector_not_in_accessible_orientation_warning',
  'source_confusing_net_name_warning',
  'source_component_pins_underspecified_warning',
  'source_no_power_pin_defined_warning',
  'source_no_ground_pin_defined_warning',
  'schematic_component_styling_warning',
  'pcb_notice',
  'source_notice',
])

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `element.type` for anything that might be in the array, including `null`. */
function elementType(element: AnyElement | null | undefined): string {
  return str(element?.type) ?? ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function point(value: unknown): { x: number; y: number } | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = num(value[0])
    const y = num(value[1])
    if (x !== undefined && y !== undefined) return { x, y }
  }
  if (value && typeof value === 'object') {
    const record = value as AnyElement
    const x = num(record.x)
    const y = num(record.y)
    if (x !== undefined && y !== undefined) return { x, y }
  }
  return undefined
}

const COMPONENT_NAME_KEYS = ['source_component_id', 'pcb_component_id', 'component_id', 'name']

/** Every string in an array-valued field, skipping a missing or hostile one. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function componentNames(element: AnyElement, byId: Map<string, string>): string[] {
  const names = new Set<string>()
  for (const key of COMPONENT_NAME_KEYS) {
    const raw = element[key]
    if (typeof raw === 'string') {
      if (byId.has(raw)) names.add(byId.get(raw)!)
      else if (/^[A-Za-z]{1,4}\d{1,3}$/.test(raw)) names.add(raw)
    }
  }
  for (const key of ['pcb_component_ids', 'source_component_ids']) {
    const list = element[key]
    if (Array.isArray(list)) {
      for (const id of list) {
        if (typeof id === 'string' && byId.has(id)) names.add(byId.get(id)!)
      }
    }
  }
  return [...names]
}

function normaliseCode(type: string): string {
  // Split camelCase *first*: `@tscircuit/checks` emits names like
  // `PcbComponentOverlapError`, and stripping `_error` before splitting would leave the
  // code as `pcb_component_overlap_error` — a different code for the same finding.
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/_error$|_warning$/, '')
    .replace(/_ids?$/, '')
}

function isBlocking(type: string): boolean {
  if (ALLOWED_WARNING_TYPES.has(type)) return false
  if (BLOCKING_SUFFIXES.some((suffix) => type === suffix || type.endsWith(suffix))) return true
  return type.endsWith('_error')
}

/** Convert a tscircuit element or check result into a `Check`. */
export function toCheck(element: unknown, byId: Map<string, string>): Check {
  const record = (element ?? {}) as AnyElement
  const type = str(record.type) ?? str(record.error_type) ?? 'unknown_check'
  const message = (
    str(record.message) ??
    str(record.error_message) ??
    str(record.error) ??
    type.replace(/_/g, ' ')
  ).slice(0, 400)

  const check: Check = {
    severity: isBlocking(type) ? 'error' : 'warning',
    code: normaliseCode(type),
    message,
  }

  const elementId =
    str(record.pcb_port_not_connected_error_id) ??
    str(record.pcb_trace_missing_error_id) ??
    str(record.pcb_placement_error_id) ??
    str(record.source_pin_must_be_connected_error_id) ??
    str(record.error_id) ??
    str(record.pcb_component_id) ??
    str(record.source_component_id)
  if (elementId) check.elementId = elementId

  const components = componentNames(record, byId)
  if (components.length) check.components = components

  const location =
    point(record.center) ??
    point(record.location) ??
    (num(record.pcb_x) !== undefined && num(record.pcb_y) !== undefined
      ? { x: num(record.pcb_x)!, y: num(record.pcb_y)! }
      : undefined)
  if (location) check.location = location

  return check
}

/** Everything the checks panel and the export manifest need to know about the board. */
export function computeStats(circuitJson: AnyElement[], board: AnyElement | undefined): DesignStats {
  const layers = new Set<string>()
  let components = 0
  let sourceTraces = 0
  let routedTraces = 0
  let nets = 0
  let vias = 0
  let holes = 0

  for (const element of circuitJson) {
    switch (elementType(element)) {
      case 'source_component':
        components += 1
        break
      case 'source_trace':
        sourceTraces += 1
        break
      case 'source_net':
        nets += 1
        break
      case 'pcb_trace': {
        routedTraces += 1
        const route = element.route
        if (Array.isArray(route)) {
          for (const step of route) {
            const layer = str((step as AnyElement).layer)
            if (layer) layers.add(layer)
          }
        }
        break
      }
      case 'pcb_via':
        vias += 1
        break
      case 'pcb_hole':
      case 'pcb_plated_hole':
        holes += 1
        break
      default:
        break
    }
  }

  return {
    components,
    sourceTraces,
    routedTraces,
    // No <board> means no layer stack; `fabChecks` blocks that separately, and claiming
    // one layer here would make the manifest describe a stack-up that does not exist.
    pcbLayers: board ? Math.max(layers.size, num(board.num_layers) ?? 1) : 0,
    boardWidthMm: num(board?.width) ?? null,
    boardHeightMm: num(board?.height) ?? null,
    boardThicknessMm: num(board?.thickness) ?? null,
    solderMaskColor: str(board?.solder_mask_color) ?? null,
    silkscreenColor: str(board?.silkscreen_color) ?? null,
    nets,
    vias,
    holes,
    elementCount: circuitJson.length,
  }
}

function fabChecks(
  circuitJson: AnyElement[],
  board: AnyElement | undefined,
  stats: DesignStats,
  preset: FabPreset,
): Check[] {
  const checks: Check[] = []
  const fail = (rule: string, message: string) =>
    checks.push({ severity: 'error', code: 'fab_capability', message, rule })

  if (!board) {
    fail('board.present', 'No <board> element was emitted, so there is nothing to fabricate.')
    return checks
  }

  if (stats.boardWidthMm === null || stats.boardHeightMm === null) {
    fail('board.size', 'The board has no fixed width/height. Use <board width="40mm" height="25mm" />.')
  } else {
    if (stats.boardWidthMm < preset.minBoardSideMm || stats.boardHeightMm < preset.minBoardSideMm) {
      fail(
        'board.min_side',
        `Board is ${stats.boardWidthMm} x ${stats.boardHeightMm} mm; ${preset.label} needs at least ${preset.minBoardSideMm} mm per side.`,
      )
    }
    if (stats.boardWidthMm > preset.maxBoardSideMm || stats.boardHeightMm > preset.maxBoardSideMm) {
      fail(
        'board.max_side',
        `Board is ${stats.boardWidthMm} x ${stats.boardHeightMm} mm; ${preset.label} supports at most ${preset.maxBoardSideMm} mm per side.`,
      )
    }
  }

  const layers = num(board.num_layers) ?? 1
  if (layers > preset.maxLayers) {
    fail(
      'board.layers',
      `Board uses ${layers} copper layers; ${preset.label} supports ${preset.maxLayers}.`,
    )
  }
  if (layers > 4) {
    fail('board.layers_sane', `${layers} copper layers is not a sane design for a low-cost fab.`)
  }

  // Board outline sanity: the authored outline must roughly match width/height.
  const outline = board.outline
  if (Array.isArray(outline) && outline.length >= 3 && stats.boardWidthMm && stats.boardHeightMm) {
    const xs = outline.map((p) => num((p as AnyElement).x)).filter((v): v is number => v !== undefined)
    const ys = outline.map((p) => num((p as AnyElement).y)).filter((v): v is number => v !== undefined)
    if (xs.length >= 3 && ys.length >= 3) {
      const spanX = Math.max(...xs) - Math.min(...xs)
      const spanY = Math.max(...ys) - Math.min(...ys)
      if (Math.abs(spanX - stats.boardWidthMm) > 0.01 || Math.abs(spanY - stats.boardHeightMm) > 0.01) {
        checks.push({
          severity: 'error',
          code: 'board_outline_mismatch',
          message: `Board outline spans ${spanX} x ${spanY} mm but width/height say ${stats.boardWidthMm} x ${stats.boardHeightMm} mm.`,
          rule: 'board.outline',
        })
      }
    }
  }

  for (const element of circuitJson) {
    const type = elementType(element)

    if (type === 'pcb_trace') {
      const width = num(element.width)
      if (width !== undefined && width < preset.minTraceMm - 1e-6) {
        checks.push({
          severity: 'error',
          code: 'fab_trace_width',
          message: `A trace is ${width.toFixed(3)} mm wide; ${preset.label} requires at least ${preset.minTraceMm} mm.`,
          elementId: str(element.pcb_trace_id),
          rule: `trace.width >= ${preset.minTraceMm}mm`,
        })
      }
    }

    if (type === 'pcb_via') {
      const diameter = num(element.diameter)
      const hole = num(element.hole_diameter)
      if (diameter !== undefined && diameter < preset.minViaPadMm - 1e-6) {
        checks.push({
          severity: 'error',
          code: 'fab_via_pad',
          message: `A via pad is ${diameter.toFixed(3)} mm; ${preset.label} requires at least ${preset.minViaPadMm} mm.`,
          elementId: str(element.pcb_via_id),
          rule: `via.pad >= ${preset.minViaPadMm}mm`,
        })
      }
      if (hole !== undefined && diameter !== undefined) {
        const ring = (diameter - hole) / 2
        if (ring < preset.minAnnularRingMm - 1e-6) {
          checks.push({
            severity: 'error',
            code: 'fab_annular_ring',
            message: `A via has a ${ring.toFixed(3)} mm annular ring; ${preset.label} requires at least ${preset.minAnnularRingMm} mm.`,
            elementId: str(element.pcb_via_id),
            rule: `via.ring >= ${preset.minAnnularRingMm}mm`,
          })
        }
      }
    }

    if (type === 'pcb_plated_hole' || type === 'pcb_hole') {
      const diameter = num(element.diameter) ?? num(element.hole_diameter)
      if (diameter !== undefined) {
        if (diameter < preset.minHoleMm - 1e-6) {
          checks.push({
            severity: 'error',
            code: 'fab_hole_min',
            message: `A ${diameter.toFixed(3)} mm hole is below the ${preset.minHoleMm} mm minimum drill for ${preset.label}.`,
            elementId: str(element.pcb_plated_hole_id) ?? str(element.pcb_hole_id),
            rule: `hole >= ${preset.minHoleMm}mm`,
          })
        } else if (diameter > preset.maxHoleMm + 1e-6) {
          checks.push({
            severity: 'error',
            code: 'fab_hole_max',
            message: `A ${diameter.toFixed(3)} mm hole is above the ${preset.maxHoleMm} mm maximum drill for ${preset.label}.`,
            elementId: str(element.pcb_plated_hole_id) ?? str(element.pcb_hole_id),
            rule: `hole <= ${preset.maxHoleMm}mm`,
          })
        }
      }
    }
  }

  return checks
}

/**
 * Every port has to be attached to something.
 *
 * tscircuit's own `source_pin_must_be_connected_error` does not fire for a two-terminal
 * part with one leg in the void: a resistor wired to a header on one side and to nothing at
 * all on the other compiles, routes, and passes every check the upstream package runs. It
 * would then be exported as "verified" and arrive at the fab dead. The eval that found this
 * is `gate-blocks-floating-pin` in evals/cases.ts.
 *
 * A port counts as connected when a `source_trace` names it, directly or through a net.
 *
 * Severity depends on the part. A spare pin on a header or an unused pin on an IC is a
 * normal design decision -- you buy a 20-way header and use two of it -- so those are
 * warnings. A two-terminal passive with a leg in the air is not a decision, it is a bug,
 * and it blocks export.
 */
const PARTS_WITHOUT_SPARE_PINS = new Set([
  'simple_resistor', 'simple_capacitor', 'simple_led', 'simple_diode', 'simple_inductor',
  'simple_transistor', 'simple_mosfet', 'simple_crystal', 'simple_led_led',
  'simple_potentiometer', 'simple_pushbutton', 'simple_fuse', 'simple_varistor',
])

function connectivityChecks(
  circuitJson: AnyElement[],
  board: AnyElement | undefined,
  byId: Map<string, string>,
): Check[] {
  if (!board) return []
  const connected = new Set<string>()

  for (const element of circuitJson) {
    if (elementType(element) !== 'source_trace') continue
    for (const id of stringList(element.connected_source_port_ids)) connected.add(id)
  }

  // `ftype` and the port count live on `source_component`; a `source_port` carries neither.
  const ftypeByComponent = new Map<string, string>()
  for (const element of circuitJson) {
    if (elementType(element) !== 'source_component') continue
    const id = str(element.source_component_id)
    if (id) ftypeByComponent.set(id, str(element.ftype) ?? '')
  }
  const portsByComponent = new Map<string, number>()
  for (const element of circuitJson) {
    if (elementType(element) !== 'source_port') continue
    const componentId = str(element.source_component_id)
    if (componentId) portsByComponent.set(componentId, (portsByComponent.get(componentId) ?? 0) + 1)
  }

  const checks: Check[] = []
  for (const element of circuitJson) {
    if (elementType(element) !== 'source_port') continue
    const portId = str(element.source_port_id)
    if (!portId || connected.has(portId)) continue

    const componentId = str(element.source_component_id)
    const name = (componentId && byId.get(componentId)) ?? componentId ?? 'unknown'
    const pin = str(element.name) ?? '?'
    const ftype = (componentId && ftypeByComponent.get(componentId)) ?? ''
    const pinCount = componentId ? portsByComponent.get(componentId) ?? 0 : 0
    const mustUseEveryPin = PARTS_WITHOUT_SPARE_PINS.has(ftype)

    checks.push({
      severity: mustUseEveryPin ? 'error' : 'warning',
      code: mustUseEveryPin ? 'floating_pin' : 'unused_connector_pin',
      message: mustUseEveryPin
        ? `${name} pin "${pin}" is not connected to anything. A two-terminal part with a leg in the void will be fabricated and will not work.`
        : `${name} pin "${pin}" is unused. That is fine for a ${pinCount}-pin part, but check it is what you meant.`,
      elementId: portId,
      components: [name],
      rule: 'every source_port belongs to a source_trace',
    })
  }
  return checks
}

/** Every IC that declares a supply pin should have a decoupling capacitor near it. */
function decouplingChecks(circuitJson: AnyElement[], board: AnyElement | undefined): Check[] {
  if (!board) return []
  const center = point(board.center) ?? { x: 0, y: 0 }
  const byId = new Map<string, AnyElement>()
  for (const element of circuitJson) {
    const id = str(element.pcb_component_id) ?? str(element.source_component_id)
    if (id) byId.set(id, element)
  }

  const capacitors: Array<{ id: string; name: string; x: number; y: number }> = []
  const ics: Array<{ id: string; name: string; x: number; y: number; supplies: string[] }> = []

  for (const element of circuitJson) {
    if (elementType(element) !== 'pcb_component') continue
    const id = str(element.pcb_component_id)
    const name = str(element.name) ?? id ?? '?'
    const x = num(element.center) ?? point(element.center)?.x ?? 0
    const y = num(element.y) ?? point(element.center)?.y ?? 0
    const ftype = str(element.ftype ?? (byId.get(id ?? '')?.source_footprint as string)) ?? ''

    if (element.source_footprint === 'simple_capacitor' || /cap/i.test(ftype) || /^C\d+$/.test(name)) {
      capacitors.push({ id: id ?? name, name, x, y })
    }
  }

  for (const element of circuitJson) {
    if (elementType(element) !== 'source_component') continue
    if (element.ftype !== 'simple_chip') continue
    const id = str(element.source_component_id) ?? ''
    const name = str(element.name) ?? '?'
    if (/^C\d+$/.test(name)) continue
    const pcb = [...byId.values()].find(
      (candidate) => candidate.source_component_id === id || str(candidate.name) === name,
    )
    const x = pcb ? (num(pcb.center) ?? point(pcb.center)?.x ?? 0) : 0
    const y = pcb ? (num(pcb.y) ?? point(pcb.center)?.y ?? 0) : 0
    const supplies = Array.isArray(element.pin_labels)
      ? (element.pin_labels as unknown[])
          .map((p) => str((p as AnyElement)?.name))
          .filter((n): n is string => Boolean(n && /^(vcc|vdd|vdd_3v3|vin|vbus|vbat|\+?\d+v\d*)$/i.test(n)))
      : []
    ics.push({ id, name, x, y, supplies })
  }

  const checks: Check[] = []
  for (const ic of ics) {
    if (ic.supplies.length === 0) continue
    const near = capacitors.some(
      (cap) => Math.hypot(cap.x - ic.x, cap.y - ic.y) <= 4,
    )
    if (!near) {
      checks.push({
        severity: 'error',
        code: 'missing_decoupling',
        message: `${ic.name} has a supply pin (${ic.supplies.join(', ')}) but no decoupling capacitor within 4 mm.`,
        components: [ic.name],
        location: { x: ic.x + center.x, y: ic.y + center.y },
        rule: 'decoupling.within_4mm',
      })
    }
  }
  return checks
}

function dedupe(checks: Check[]): Check[] {
  const seen = new Set<string>()
  const out: Check[] = []
  for (const check of checks) {
    const key = `${check.severity}:${check.code}:${check.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(check)
  }
  return out
}

/**
 * Run every check over a compiled board.
 *
 * `tscircuitChecks` is the raw output of `@tscircuit/checks`'s `runAllChecks`, which runs
 * inside the sandbox. A crash there is an **error**, not a warning: a checker that did not
 * run cannot be reported as "passed".
 */
export function evaluateDesign(
  circuitJson: unknown[],
  tscircuitChecks: unknown[],
  fabPresetId: string | null | undefined,
): CheckReport {
  const elements = circuitJson as AnyElement[]
  const board = elements.find((element) => elementType(element) === 'pcb_board')
  const preset = getFabPreset(fabPresetId)
  const stats = computeStats(elements, board)

  const byId = new Map<string, string>()
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    // Only components may define a name here. A `source_port` carries both a
    // `source_component_id` and a `name` (the pin name), so a loop over every element
    // lets the last port win and every message in the report names pins instead of
    // parts. The eval that caught it is `gate-blocks-floating-pin`.
    const type = elementType(element)
    if (type !== 'source_component' && type !== 'pcb_component') continue
    const id = str(element.pcb_component_id) ?? str(element.source_component_id)
    const name = str(element.name)
    if (id && name) byId.set(id, name)
  }

  const emitted = elements
    .filter((element) => {
      const type = elementType(element)
      return isBlocking(type) || ALLOWED_WARNING_TYPES.has(type)
    })
    .map((element) => toCheck(element, byId))

  const fromChecks = (tscircuitChecks ?? []).map((check) => toCheck(check, byId))

  const all = dedupe([
    ...emitted,
    ...fromChecks,
    ...fabChecks(elements, board, stats, preset),
    ...decouplingChecks(elements, board),
    ...connectivityChecks(elements, board, byId),
  ])

  const blockingCount = all.filter((check) => check.severity === 'error').length
  return {
    checks: all.slice(0, 200),
    blockingCount,
    warningCount: all.length - blockingCount,
    passed: blockingCount === 0,
    fabPresetId: preset.id,
    fabPresetLabel: preset.label,
    stats,
  }
}
