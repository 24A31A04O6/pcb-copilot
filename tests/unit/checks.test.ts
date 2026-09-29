import { describe, expect, it } from 'vitest'

import { computeStats, evaluateDesign, toCheck } from '@/lib/checks'
import { DEFAULT_FAB_PRESET_ID } from '@/lib/server/checks/fab-presets'

type Element = Record<string, unknown>

const board = (overrides: Element = {}): Element => ({
  type: 'pcb_board',
  pcb_board_id: 'pcb_board_1',
  width: 40,
  height: 30,
  thickness: 1.6,
  num_layers: 2,
  ...overrides,
})

const component = (id: string, name: string, extra: Element = {}): Element[] => [
  { type: 'source_component', source_component_id: id, name, ftype: 'simple_resistor', ...extra },
  { type: 'pcb_component', pcb_component_id: `pcb_${id}`, source_component_id: id, name, center: { x: 0, y: 0 } },
]

describe('severity classification', () => {
  it('treats an unknown element type that ends in _error as blocking', () => {
    const check = toCheck({ type: 'pcb_some_new_rule_error', message: 'nope' }, new Map())
    expect(check.severity).toBe('error')
  })

  it('keeps the documented advisory types as warnings even though they are advisory-sounding', () => {
    for (const type of [
      'pcb_trace_too_long_warning',
      'source_no_power_pin_defined_warning',
      'schematic_component_styling_warning',
    ]) {
      expect(toCheck({ type, message: 'fyi' }, new Map()).severity).toBe('warning')
    }
  })

  it('promotes a known tscircuit blocking type to an error', () => {
    for (const type of ['pcb_port_not_connected_error', 'pcb_trace_missing_error', 'pcb_placement_error']) {
      expect(toCheck({ type, message: 'broken' }, new Map()).severity).toBe('error')
    }
  })

  it('normalises the type into a stable, switchable code', () => {
    expect(toCheck({ type: 'pcb_port_not_connected_error' }, new Map()).code).toBe('pcb_port_not_connected')
    expect(toCheck({ type: 'pcbComponentOverlapError' }, new Map()).code).toBe('pcb_component_overlap')
  })

  it('always produces a human message', () => {
    for (const type of ['pcb_placement_error', 'pcb_notice', 'source_notice']) {
      expect(toCheck({ type }, new Map()).message.length).toBeGreaterThan(0)
    }
  })

  it('names the components involved when it can resolve them', () => {
    const byId = new Map([['pcb_r1', 'R1']])
    const check = toCheck(
      { type: 'pcb_component_overlap_error', pcb_component_id: 'pcb_r1', message: 'overlap' },
      byId,
    )
    expect(check.components).toContain('R1')
  })
})

describe('evaluateDesign', () => {
  it('passes a minimal, well-formed board', () => {
    const circuit = [
      board(),
      ...component('sc_r1', 'R1'),
      { type: 'pcb_trace', pcb_trace_id: 't1', width: 0.25, layer: 'top' },
    ]
    const report = evaluateDesign(circuit, [], DEFAULT_FAB_PRESET_ID)
    expect(report.blockingCount).toBe(0)
    expect(report.passed).toBe(true)
    expect(report.fabPresetId).toBe(DEFAULT_FAB_PRESET_ID)
  })

  it('blocks the design when a port is unconnected', () => {
    const circuit = [board(), ...component('sc_r1', 'R1'), { type: 'pcb_port_not_connected_error', message: 'R1.1 is floating' }]
    const report = evaluateDesign(circuit, [], DEFAULT_FAB_PRESET_ID)
    expect(report.passed).toBe(false)
    expect(report.blockingCount).toBeGreaterThan(0)
    expect(report.checks.some((check) => check.code === 'pcb_port_not_connected')).toBe(true)
  })

  it('blocks a design whose copper is finer than the chosen fab can make', () => {
    const circuit = [
      board(),
      ...component('sc_r1', 'R1'),
      { type: 'pcb_trace', pcb_trace_id: 't1', width: 0.05, layer: 'top' },
    ]
    const report = evaluateDesign(circuit, [], DEFAULT_FAB_PRESET_ID)
    expect(report.passed).toBe(false)
    expect(report.checks.some((check) => check.code === 'fab_trace_width')).toBe(true)
  })

  it('blocks a board with more layers than the fab builds', () => {
    const circuit = [board({ num_layers: 8 }), ...component('sc_r1', 'R1')]
    const report = evaluateDesign(circuit, [], DEFAULT_FAB_PRESET_ID)
    expect(report.passed).toBe(false)
  })

  it('warns about a long trace without blocking the design', () => {
    const circuit = [
      board(),
      ...component('sc_r1', 'R1'),
      { type: 'pcb_trace', pcb_trace_id: 't1', width: 0.25, layer: 'top', route: [{ x: 0, y: 0, layer: 'top' }, { x: 200, y: 0, layer: 'top' }] },
    ]
    const report = evaluateDesign(circuit, [], DEFAULT_FAB_PRESET_ID)
    expect(report.warningCount).toBeGreaterThanOrEqual(0)
    expect(report.blockingCount).toBe(0)
  })

  it('reports a missing power or ground pin as advisory, not blocking', () => {
    const report = evaluateDesign([board(), ...component('sc_r1', 'R1')], [], DEFAULT_FAB_PRESET_ID)
    const advisories = report.checks.filter((check) => check.code.includes('power_pin') || check.code.includes('ground_pin'))
    for (const check of advisories) expect(check.severity).toBe('warning')
  })

  it('falls back to the default preset for an unknown id instead of silently passing', () => {
    const circuit = [board({ num_layers: 8 }), ...component('sc_r1', 'R1')]
    const report = evaluateDesign(circuit, [], 'not-a-real-preset')
    expect(report.fabPresetId).toBe(DEFAULT_FAB_PRESET_ID)
    expect(report.passed).toBe(false)
  })

  it('treats a crash in the checker itself as blocking, not as a pass', () => {
    // An empty, board-less array is not a valid design; it must not report "passed".
    const report = evaluateDesign([], [], DEFAULT_FAB_PRESET_ID)
    expect(report.passed).toBe(false)
  })

  it('bounds the number of findings it returns', () => {
    const noisy: Element[] = [board()]
    for (let i = 0; i < 500; i += 1) {
      noisy.push({ type: 'pcb_port_not_connected_error', message: `floating ${i}` })
    }
    const report = evaluateDesign(noisy, [], DEFAULT_FAB_PRESET_ID)
    expect(report.checks.length).toBeLessThanOrEqual(200)
    expect(report.blockingCount).toBeGreaterThan(0)
  })

  it('deduplicates repeated findings from the element list and the checker output', () => {
    const element = { type: 'pcb_port_not_connected_error', message: 'R1.1 is floating' }
    const report = evaluateDesign([board(), element, element], [element], DEFAULT_FAB_PRESET_ID)
    expect(report.checks.filter((check) => check.code === 'pcb_port_not_connected')).toHaveLength(1)
  })

  it('never throws on a hostile or empty circuit', () => {
    expect(() => evaluateDesign([], [], DEFAULT_FAB_PRESET_ID)).not.toThrow()
    expect(() => evaluateDesign([null, undefined, 7, 'x'] as unknown[], [], null)).not.toThrow()
    expect(() => evaluateDesign([{}], [null, 3] as unknown[], DEFAULT_FAB_PRESET_ID)).not.toThrow()
  })
})

describe('computeStats', () => {
  it('counts components, traces, nets and layers from the circuit', () => {
    const circuit = [
      board({ num_copper_layers: 2 }),
      ...component('sc_r1', 'R1'),
      { type: 'source_net', source_net_id: 'n1', name: 'VCC' },
      { type: 'pcb_trace', pcb_trace_id: 't1', layer: 'top' },
      { type: 'pcb_trace', pcb_trace_id: 't2', layer: 'bottom' },
    ]
    const stats = computeStats(circuit as never, board() as never)
    expect(stats.components).toBeGreaterThanOrEqual(1)
    expect(stats.nets).toBe(1)
    expect(stats.routedTraces).toBe(2)
    expect(stats.pcbLayers).toBe(2)
    expect(stats.boardWidthMm).toBe(40)
    expect(stats.boardHeightMm).toBe(30)
  })

  it('reports null geometry when there is no board, rather than guessing zero', () => {
    const stats = computeStats([] as never, undefined as never)
    expect(stats.boardWidthMm).toBeNull()
    expect(stats.boardHeightMm).toBeNull()
    expect(stats.pcbLayers).toBe(0)
  })
})

describe('connectivity', () => {
  const port = (id: string, componentId: string, name = 'pin1'): Element => ({
    type: 'source_port',
    source_port_id: id,
    source_component_id: componentId,
    name,
  })

  const trace = (id: string, ports: string[], nets: string[] = []): Element => ({
    type: 'source_trace',
    source_trace_id: id,
    connected_source_port_ids: ports,
    connected_source_net_ids: nets,
  })

  const resistor = component('source_component_R', 'R1')

  it('blocks a two-terminal part with a leg in the void', () => {
    const report = evaluateDesign(
      [
        board(),
        ...resistor,
        port('source_port_0', 'source_component_R', 'pin1'),
        port('source_port_1', 'source_component_R', 'pin2'),
        trace('source_trace_0', ['source_port_0']),
      ],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    const floating = report.checks.filter((c) => c.code === 'floating_pin')
    expect(floating).toHaveLength(1)
    expect(floating[0].severity).toBe('error')
    expect(floating[0].message).toContain('R1')
    expect(floating[0].message).toContain('pin2')
    expect(report.passed).toBe(false)
  })

  it('accepts a part with every pin traced', () => {
    const report = evaluateDesign(
      [
        board(),
        ...resistor,
        port('source_port_0', 'source_component_R', 'pin1'),
        port('source_port_1', 'source_component_R', 'pin2'),
        trace('source_trace_0', ['source_port_0', 'source_port_1']),
      ],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    expect(report.checks.filter((c) => c.code === 'floating_pin')).toHaveLength(0)
    expect(report.passed).toBe(true)
  })

  it('treats an unused pin on a header as a warning, not a block', () => {
    const report = evaluateDesign(
      [
        board(),
        { type: 'source_component', source_component_id: 'source_component_J', name: 'J1', ftype: 'simple_pin_header' },
        port('source_port_0', 'source_component_J', 'pin1'),
        port('source_port_1', 'source_component_J', 'pin2'),
        port('source_port_2', 'source_component_J', 'pin3'),
        trace('source_trace_0', ['source_port_0', 'source_port_1']),
      ],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    const unused = report.checks.filter((c) => c.code === 'unused_connector_pin')
    expect(unused).toHaveLength(1)
    expect(unused[0].severity).toBe('warning')
    expect(report.checks.filter((c) => c.code === 'floating_pin')).toHaveLength(0)
    expect(report.passed).toBe(true)
  })

  it('reads ftype from source_component, not from source_port', () => {
    // A regression here silently downgrades every floating-pin error to a warning.
    const report = evaluateDesign(
      [
        board(),
        { type: 'source_component', source_component_id: 'source_component_D', name: 'D1', ftype: 'simple_diode' },
        port('source_port_0', 'source_component_D', 'anode'),
        port('source_port_1', 'source_component_D', 'cathode'),
      ],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    expect(report.checks.filter((c) => c.code === 'floating_pin')).toHaveLength(2)
  })

  it('says nothing about connectivity when there is no board to fabricate', () => {
    const report = evaluateDesign(
      [port('source_port_0', 'source_component_R', 'pin1')],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    expect(report.checks.filter((c) => c.code === 'floating_pin')).toHaveLength(0)
  })

  it('ignores a hostile non-array field instead of throwing', () => {
    const report = evaluateDesign(
      [
        board(),
        ...resistor,
        port('source_port_0', 'source_component_R', 'pin1'),
        { type: 'source_trace', source_trace_id: 'source_trace_0', connected_source_port_ids: 'not-an-array' },
      ],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    expect(report.checks.filter((c) => c.code === 'floating_pin')).toHaveLength(1)
  })
})

describe('component naming in messages', () => {
  it('names the part, not the pin', () => {
    // A `source_port` carries both `source_component_id` and `name`. Reading the name map
    // from every element lets the last port overwrite its own component, and every message
    // in the report then reads "pin2 pin pin2 is not connected".
    const report = evaluateDesign(
      [
        board(),
        { type: 'source_component', source_component_id: 'source_component_C', name: 'C7', ftype: 'simple_capacitor' },
        {
          type: 'source_port',
          source_port_id: 'source_port_0',
          source_component_id: 'source_component_C',
          name: 'pin1',
        },
        {
          type: 'source_port',
          source_port_id: 'source_port_1',
          source_component_id: 'source_component_C',
          name: 'pin2',
        },
      ],
      [],
      DEFAULT_FAB_PRESET_ID,
    )
    const floating = report.checks.filter((c) => c.code === 'floating_pin')
    expect(floating.map((c) => c.components?.[0])).toEqual(['C7', 'C7'])
  })
})
