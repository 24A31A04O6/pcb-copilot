# Research log

Every fact in this file was looked up rather than recalled, and every entry records where it
came from, when it was checked, and what it changed. If a claim in this repository cannot be
traced to a line here or to an installed package, it is a guess and should be treated as one.

Checked on **2026-09-29** unless stated otherwise.

---

## Models and providers

### GLM 5.3 Flash is the default

- **Source:** <https://fireworks.ai/models/fireworks/glm-5p3-flash>
- **Checked:** 2026-08-26
- **Takeaway:** serverless, 320B total / 18B active parameters, 1,040k context, function
  calling supported. Pinned as `accounts/fireworks/models/glm-5p3-flash`, the default in
  `lib/server/env.ts`.

### DeepSeek V4.1 Flash is the fallback

- **Sources:**
  <https://fireworks.ai/models/fireworks/deepseek-v4p1-flash> (2026-09-10),
  <https://models.dev/providers/fireworks-ai/>
- **Takeaway:** 552B parameters, 1M context, cheaper than GLM at researched prices
  ($0.14/$0.28 per Mtok against $0.40/$1.60). Used only for availability, never for a design
  that merely failed to parse.

### The previous fallback id is dead

- **Sources:**
  <https://github.com/vellum-ai/vellum-assistant/pull/43394> (2026-09-28),
  <https://github.com/Zoo-Code-Org/Zoo-Code/issues/1845> (2026-09-28)
- **Takeaway:** the older DeepSeek serverless id returns 404 / "model not found, not
  deployed". The repository's own `.env.local.example` documented that dead id until Phase 7;
  `docs/AUDIT.md` §11 flagged it. `.env.example` now names `deepseek-v4p1-flash`.

### Model ids are pinned, and the schema refuses aliases

- **Source:** inspection of `lib/server/env.ts`
- **Takeaway:** `modelId` rejects anything ending in `-latest`. A moving alias changes every
  design the app produces between one deploy and the next, with no diff to review.

---

## Fireworks API behaviour

### `json_schema` is the response format, and it disables reasoning

- **Source:** <https://docs.fireworks.ai/structured-responses/structured-response-formatting>
- **Takeaway:** `response_format: { type: "json_schema", json_schema: { name, schema } }`.
  Using it turns off reasoning output. The brief stage uses it; the code-generation stage
  deliberately does **not**, because reasoning measurably improves the TSX. That is why
  `callStructured` and `callModel` are separate functions rather than one with a flag.

### Reasoning effort is a DeepSeek-family control

- **Source:** <https://docs.fireworks.ai/api-reference/post-completions>
- **Takeaway:** `reasoning_effort` is model-specific. Not set anywhere in this app, because
  it is not documented for GLM and sending an unknown field is how a request starts
  returning 400.

### A proxy can silently strip `json_schema`

- **Source:** <https://github.com/BerriAI/litellm/issues/29604> (2026-09-29)
- **Takeaway:** LiteLLM was observed dropping `json_schema` from Fireworks requests. This app
  does not use LiteLLM, but it is why `tests/integration/fireworks.test.ts` asserts the exact
  wire body rather than only the parsed result.

### Retryable statuses

- **Sources:** <https://docs.fireworks.ai/api-reference/post-completions>, the same issue
  tracker
- **Takeaway:** 408, 425, 429, 5xx, 522, 524 are retried. 400, 401, 403, 404, 422 are not:
  a malformed request retried three times is a slower way to return the same error.
  Implemented as `RETRYABLE_STATUS` in `lib/server/llm/client.ts`.

---

## tscircuit

### The board layer count prop is `layers`, not `numLayers`

- **Source:** the installed `@tscircuit/props@0.0.656`,
  `lib/components/board.ts`, line 89: `layers?: 1 | 2 | 4 | 6 | 8 | 10`
- **Takeaway:** `numLayers={4}` is not in the schema and is **silently ignored** — the board
  compiles as two layers and passes every check. The `four-layer-controller` golden was
  wrong for several iterations because of exactly this.

### A power-to-ground capacitor is capped at 1 mm of trace

- **Source:** the installed `@tscircuit/core@0.0.1847`,
  `lib/components/normal-components/Capacitor_getAutomaticMaxDecouplingTraceLength.ts`:
  `DEFAULT_MAX_DECOUPLING_TRACE_LENGTH_MM = 1`
- **Takeaway:** when a capacitor's two pins are connected to a power pin and a ground pin,
  tscircuit sets `max_length: 1` on every trace touching it and refuses to route anything
  longer. `maxDecouplingTraceLength` on `<capacitor>` overrides it. The detection keys on
  pin *name* — `VIN` triggers it, `SUPPLY` does not.

### A crystal forbids vias on its traces

- **Source:** the installed `@tscircuit/core@0.0.1847`, `DEFAULT_CRYSTAL_MAX_VIA_COUNT`
- **Takeaway:** every trace touching a `<crystal>` gets `max_via_count: 0`. A load-capacitor
  network that crosses itself therefore cannot be routed, and reports
  `PCB trace uses N vias, exceeding the 0 maximum`. `maxTraceLength` on the crystal sets the
  length budget (default 10 mm).

### `<crystal>` requires `loadCapacitance`; `<transistor>` requires `type`; `<mosfet>` requires `mosfetMode`

- **Source:** the installed `@tscircuit/props@0.0.656`, `lib/components/*.ts`
- **Takeaway:** all three are validated as required by zod and fail component creation with
  `source_failed_to_create_component`. Six of the first twenty-three golden designs did not
  compile for this reason, plus `<potentiometer maxResistance>` and the wiper being `pin2`.

### The potentiometer wiper is `pin2`, and `pot_334` is not a footprinter string

- **Sources:** `@tscircuit/props` `lib/components/potentiometer.ts`; `@tscircuit/footprinter@0.0.426`
- **Takeaway:** `potentiometerPinLabels = ["pin1", "pin2", "pin3"]` with no `wiper` alias, and
  `maxResistance` is required. The footprinter function is `potentiometer`; `pot_334` parses
  as function `pot` and fails with `Invalid footprint function, got "pot"`.

### Footprint strings are parsed, not looked up

- **Source:** `@tscircuit/footprinter@0.0.426`, verified by compiling 29 candidate strings in
  the real sandbox
- **Takeaway:** the string is split into a function name and parameters. An unrecognised
  function produces `source_invalid_component_property`; a wrong *parameter* is accepted and
  produces a footprint of the wrong size. This is why `docs/knowledge/footprints.md` lists
  verified strings rather than a naming convention.

### The sandbox cannot reach a CDN, so footprints must be built in

- **Source:** the compile worker's own `fetch` stub
- **Takeaway:** every golden design emits a `source_part_not_found_warning` because
  supplier part numbers cannot be fetched. That is expected and it is a warning, not a
  failure.

### Circuit JSON ids are not deterministic

- **Source:** two compilations of the same source, diffed
- **Takeaway:** tscircuit mints ids like `source_part_not_found_warning_1gZfWA7CYI` with a
  random ten-character suffix, while structural ids like `pcb_trace_1` are deterministic.
  `lib/goldens/run.ts` canonicalises the random ones before hashing, or no golden hash would
  ever be stable.

### Solder mask and silkscreen colours

- **Sources:**
  <https://github.com/tscircuit/core/pull/3746> (per-side mask/silkscreen copied to `pcb_board`),
  <https://github.com/tscircuit/core/pull/3938> and
  <https://github.com/tscircuit/circuit-json-to-gltf/pull/206> (default mask changed from neon
  green to subdued FR-4 greens),
  and the installed `@tscircuit/3d-viewer@0.0.598` `dist/index.js`, which is the
  authoritative one for the version this app runs
- **Takeaway:** `resolveSoldermaskColor()` accepts preset names *and* CSS hex/RGB/HSL, and
  feeds both the substrate colour and the mask texture. `getBoardEdgeColor()` reads
  `solder_mask_color`. This app passes hex so the board is a specific, chosen colour rather
  than the viewer's default. See `docs/DECISIONS.md` §5.
- **Superseded:** an earlier entry cited
  <https://github.com/tscircuit/3d-viewer/issues/957> for ignored mask colour. Reading the
  installed source contradicted it for 0.0.598; the issue tracker was the weaker source.

---

## Fabrication capability

### JLCPCB two-layer standard

- **Source:** <https://jlcpcb.com/capabilities/pcb-capabilities>
- **Checked:** 2026-09-29
- **Takeaway:** min trace/space 0.127 mm, min drill 0.3 mm, board 5–500 mm. Recorded as
  `jlcpcb-2layer-standard` in `lib/server/checks/fab-presets.ts`.

### JLCPCB four-layer

- **Sources:** <https://jlcpcb.com/blog/pcb-design-rules-best-practices> (2025-12-26),
  <https://www.nextpcb.com/blog/pcb-capabilities-comparison-jlcpcb-vs-pcbway-vs-nextpcb> (2026-06-17),
  <https://www.brainvoyage.blog/jlcpcb-design-rules-guide> (2026-04-08)
- **Takeaway:** JLCPCB quotes 3.5 mil (0.089 mm) trace/space for 4+ layers, but community
  reports of rejection at that width are widespread. The preset holds the line at a round
  4 mil (0.1 mm) and uses a 0.2 mm minimum drill, the tighter 4-layer figure JLCPCB quotes.
  Recorded as `jlcpcb-4layer-standard`. This preset was added because the four-layer golden
  was being blocked by a 2-layer-only gate.

### PCBWay two-layer standard

- **Sources:** <https://www.pcbway.com/capabilities/> and the NextPCB comparison above
- **Takeaway:** a single 0.1 mm figure for both trace and spacing regardless of copper
  weight. Recorded as `pcbway-2layer-standard`.

### The default preset is the intersection, not the best of one

- **Source:** the other three rows
- **Takeaway:** `prototype-hobby-2layer` takes the worst of each: 0.2 mm trace and space,
  0.4 mm drill, 0.5 mm edge clearance. A design that passes it passes everywhere. It is the
  default because a "verified" badge is a promise.

### Lookup bug worth recording

- **Source:** `tests/unit/fab-presets.test.ts`, failing the moment a fourth preset was added
- **Takeaway:** `getFabPreset` looked its default up as `FAB_PRESETS[3]`. Adding a preset
  silently changed which fab an unknown id fell back to. It now looks the default up by id
  and throws if the list ever loses it.

---

## Parts search

- **Sources:** <https://www.snapeda.com/get-api/>, <https://api.snapeda.com/about/FAQ/>,
  <https://support.snapmagic.com/en/articles/2957835-does-snapmagic-have-an-api>
- **Checked:** 2026-09-29
- **Takeaway:** SnapMagic Search is the strongest free/premium parts-and-footprints API, and
  it is sold by request — there is no self-serve key, and the HTTP contract is not public.
  Octopart/Nexar needs an approved application. **There is no open parts-search API a
  serverless function can rely on.** The tool is therefore wired to a configurable
  `PART_SEARCH_URL` and disabled by default, rather than pointed at a guessed vendor
  endpoint. See `docs/DECISIONS.md` §6 and `docs/VERIFICATION.md`.

---

## Still unresolved

These were needed by the task and are **not** yet verified. They are listed here rather than
guessed at.

| Question | Why it is open |
| --- | --- |
| Fireworks rate limits and concurrency tiers | The public docs do not publish a per-key tier table; the app ships an in-process limiter with an optional Upstash backend rather than a number it cannot cite. |
| Vercel `maxDuration` ceiling per plan | `vercel.json` sets 300 s for `/api/design`; whether that is accepted depends on the plan, and it has not been deployed to check. |
| The tscircuit playground URL scheme | `https://tscircuit.com/playground?code=<base64>` is used in `app/page.tsx`; the parameter name was taken from a doc snippet and has not been opened in a browser to confirm it still renders. |
| Gerber/BOM/PnP converter contracts | `@tscircuit/circuit-json-to-gerber`, `-to-bom-csv` and `-to-pnp-csv` are pinned and exercised by `tests/integration/export-gate.test.ts`, but their *upstream* file-format compliance has not been checked against a fab's DFM review. |
| Chromium download for the browser suite | The Playwright CDN was unreachable from this sandbox (`ECONNRESET`). The suite is written and wired into CI; it has not been executed here. See `docs/TESTING.md`. |
