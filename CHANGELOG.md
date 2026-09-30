# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[semantic versioning](https://semver.org/), with the caveat that the pinned `@tscircuit/*`
packages are pre-1.0 and their output is not stable across releases — which is why every
golden design carries a hash.

---

## [3.0.0] — 2026-09-29

The brief-to-verified-board pipeline, rebuilt from an audit.

### Added

**Pipeline**

- Five stages — brief, codegen, compile, checks, repair — each emitting an SSE event, with a
  bounded repair loop that gives each attempt the exact findings from the previous one.
- Brace-aware JSON extraction, so a brace inside a string or a comment no longer truncates a
  brief.
- One schema-repair call and one fallback-model call, in that order and no more. A design
  that failed to parse gets a repair, not a different model.
- A typed error taxonomy. Every code has a message a person can act on, an HTTP status, and
  server-only detail that is never serialised into a response.
- Redacted, request-id-carrying logs. The API key cannot reach one.
- A deterministic cache key over brief, model, toolchain, fab preset and solder mask.

**Retrieval**

- `lib/retrieval.ts` — BM25 with an identifier boost, so `pinCount` returns the components
  that declare `pinCount` and never a chunk that merely mentions it in prose.
- 156 chunks extracted from the installed `@tscircuit/props@0.0.656` at build time, plus
  three hand-written notes on authoring, footprints and fab rules.
- Injected into the code-generation system prompt, so the model is grounded in the API this
  deployment actually runs.

**Checks and fabrication**

- A connectivity pass that tscircuit does not have. A two-terminal part with a leg in the
  void used to compile, route and pass; it now blocks export. An unused pin on a header is a
  warning, because that is a decision.
- Fab presets, each with a source URL and the date it was checked. The default is the
  *intersection* of JLCPCB and PCBWay, because "verified" is a promise.
- A researched JLCPCB four-layer preset, added because a four-layer board was being blocked
  by a two-layer-only gate.

**Golden designs**

- 23 boards in `designs/golden/`, each real tscircuit source, each compiled by the real
  sandbox, each hashed. `pnpm run golden:hash` regenerates and prints drift.

**Evals**

- 40 cases. 24 run offline against the real compiler, the real check engine and the real
  index; 16 need a key and report `skipped` without one.
- `--compare` runs every model case against both models and writes a comparison with cost
  per brief.

**Optional part search**

- A `search_parts` tool, offered only when a catalogue is configured. The system prompt says
  which world the model is in either way, and every design carries `partSearchUsed` so the UI
  can say when a run had no catalogue behind it.

**Interface**

- A command palette on `Cmd/Ctrl-K`, built from the same handlers the page uses so it cannot
  drift. Single-key shortcuts for views, generate and history.
- PWA: a manifest and a service worker that caches the app shell and **never** the API.
- Brand assets — icons, the OG image, the mascot sheet — generated from the same pixel data
  as the mascot, by a dependency-free PNG encoder.

**Operational**

- `/api/health` reports configuration, toolchain versions and fab presets without printing a
  secret value, and returns 503 when it is not ready.
- A secret scanner that fails the build, validated by planting three real leaks.
- Four CI jobs, splitting the cheap gate from the compile-heavy one from the browser one from
  the model evals, which are `workflow_dispatch` only.
- Playwright with axe and committed visual baselines.

### Fixed

Three bugs found by the eval suite the first time it ran, none of which had a test:

- `extractTsx` decided whether leading text was code by **counting lines**, so a one-line
  "Sure! Here is your design." survived into the module and broke the compile with a message
  about the wrong thing.
- The component-name map in the check engine was built from every element, and a
  `source_port` has both a `source_component_id` and a `name` — so the last port overwrote
  its component and **every check message in the app named pins instead of parts**.
- `getFabPreset` looked its default up as `FAB_PRESETS[3]`. Adding a fourth preset silently
  changed which fab an unknown id fell back to.

### Changed

- The default model is `glm-5p3-flash`, with `deepseek-v4p1-flash` as an opt-in fallback. The
  previous fallback id returned 404; the repository's own example env file documented it.
- The fabrication default is two layers and conservative. A four-layer design needs the
  four-layer preset chosen, explicitly.
- The board layer prop is `layers`. `numLayers` is silently ignored by tscircuit, which meant
  "four-layer" designs were quietly two-layer.

### Known gaps

- No live Fireworks call has been made in this environment, so no model-dependent claim in
  this release is backed by a real run.
- The browser suite has never executed: the Playwright CDN refused the Chromium download.
- The part-search tool has never run against a real backend; there is no open, self-serve
  parts API to point it at.
- `docs/MODEL-COMPARISON.md` has not been produced, so the primary-model choice rests on
  price and context length rather than measured quality.

`docs/VERIFICATION.md` lists all eight, with what would close each one.
