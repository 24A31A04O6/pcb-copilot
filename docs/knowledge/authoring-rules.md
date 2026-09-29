---
topic: tscircuit-authoring
title: Writing a tscircuit board
---

## The shape of a board module

A board file exports a single default React component. The root element is `<board>`; every
other element must be inside it.

```tsx
export default () => (
  <board width="40mm" height="25mm">
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="330" footprint="0603" pcbX={0} pcbY={0} schX={0} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
  </board>
)
```

There must be no imports, no `require`, no top-level side effects and no network access: the
compile sandbox rejects source that reaches for anything outside tscircuit.

## Every component needs a name and both coordinate systems

`name` is the reference designator and is required — the checks and the BOM are keyed on it.
`pcbX`/`pcbY` place the part on the board in millimetres; `schX`/`schY` place it on the
schematic. A component with only `pcbX`/`pcbY` will not appear in the schematic, and one
with only `schX`/`schY` will not appear in the PCB.

## Values are strings, geometry is numbers

`resistance="330"`, `capacitance="100nF"`, `voltage="5V"` are parsed strings and accept
engineering suffixes: `1k`, `4k7`, `100nF`, `10uF`, `1meg`. Use a plain number for
`resistance="330"`; do not write `resistance={330}` with a unit in a string prop.

## A part that is not routed is a blocking error

`source_traces_have_pcb_traces` fails the export gate for any `<trace>` that has no matching
`pcb_trace`. Either give the trace a `pcbRoute`, or place the connected parts close enough
for the autorouter to connect them. An explicitly unrouted trace is reported as
`pcb_trace_missing_error`, which blocks fabrication.

## Pin selectors

`from` and `to` take a selector: `".J1 > .pin1"` means pin 1 of J1. Selector syntax is
documented under the `port-and-net-selectors` topic. A `pinheader` exposes `.pin1`,
`.pin2`, … and also named pins from `pinLabels`.
