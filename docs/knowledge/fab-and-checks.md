---
topic: checks-and-fab
title: Checks and fabrication rules
---

## What blocks an export

The fabrication gate is closed while any finding has severity `error`. Two families produce
them: tscircuit's own design-rule checks, and the fab-capability rules this app adds.

## Fab capability rules

For the preset the design is checked against:

- `board.size` — a `<board>` with no fixed `width`/`height` cannot be fabricated
- `board.min_side` / `board.max_side` — the envelope must be inside the fab's range
- `board.layers` — more copper layers than the fab builds
- `board.outline_mismatch` — a hand-authored `outline` that disagrees with `width`/`height`
- `fab_trace_width` — a `pcb_trace` narrower than the fab's minimum
- `fab_via_pad` / `fab_annular_ring` — a via with too little copper around the hole
- `fab_hole_min` / `fab_hole_max` — a drill outside the fab's range

The default preset is the conservative intersection of two low-cost 2-layer fabs: 0.2 mm
trace and space, 0.4 mm minimum drill, 2 layers, 10–150 mm per side. A design that passes
the default passes the cheaper named presets too.

## Rules that warn rather than block

- `pcb_trace_too_long_warning` — a long trace is a signal-integrity smell, not a fab error
- `pcb_component_missing_courtyard_warning` — no courtyard, so overlap cannot be checked
- `source_no_power_pin_defined_warning` / `source_no_ground_pin_defined_warning`
- `schematic_component_styling_warning`

## Decoupling

Every IC that declares a supply pin should have a capacitor within about 3 mm of that pin.
`evaluateDesign` flags a supply pin with no capacitor in range. Put the capacitor's `pcbX`
and `pcbY` within a few millimetres of the IC's matching pin, not merely on the same board.

## Placement that avoids blocking errors

- Keep every part inside the board outline; a part outside it is `pcb_component_outside_board_error`
- Leave at least the fab's edge clearance (`0.5 mm` on the default preset) between a pad and the outline
- Space parts so their courtyards do not overlap
- Put a decoupling capacitor adjacent to each IC supply pin
- Give connectors an accessible orientation so they are not blocked by the board edge
