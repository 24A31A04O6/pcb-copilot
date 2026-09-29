# Architecture

Describe a PCB in plain English; get a tscircuit design that compiles, passes its
fabrication checks, and exports as real manufacturing files.

---

## The shape of it

```
browser ──POST /api/design──▶ pipeline ──▶ Fireworks (brief JSON)
                                        └─▶ Fireworks (tscircuit TSX)
                                             └─▶ sandbox (compile + tscircuit checks)
                                                  └─▶ check engine (connectivity, fab, decoupling)
                                                       ├─ blocked ─▶ repair ─┐
                                                       └─ clear ──────────────┴─▶ verified
browser ◀──SSE events────────┘                                              │
                                                                              ▼
                                        POST /api/export ──▶ Gerbers · BOM · PnP · manifest · README
```

The only thing that makes a design shippable is the last box. Everything upstream of it
produces a proposal.

## The five stages

| Stage | What it does | What can fail it |
| --- | --- | --- |
| **brief** | Plain English → validated JSON brief, `json_schema` on the wire *and* in the prompt | `LLM_INVALID_JSON`, `LLM_SCHEMA_MISMATCH`, `LLM_TRUNCATED` |
| **codegen** | Brief → tscircuit TSX, with retrieved API reference in the system prompt | `LLM_INVALID_JSON`, `COMPILE_FAILED` |
| **compile** | TSX → Circuit JSON, in an isolated child process | `COMPILE_FAILED`, `LLM_TIMEOUT` |
| **checks** | Circuit JSON → structured findings, fab preset applied | `CHECKS_FAILED` |
| **repair** | Blocking findings → a focused second attempt, up to three | exhausts to a typed error |

Every stage emits an SSE event, so the browser can say what is happening rather than spin.

---

## Directory map

```
app/
  page.tsx              The whole UI: brief, pipeline, tabs, palette, history
  manifest.ts           PWA manifest, generated from the same pixel data as the mascot
  api/design/           POST → SSE stream of the five stages
  api/export/           POST → gated manufacturing files
  api/designs/          Gallery listing and permalink lookup
  api/reviews/          Revision loop
  api/health/           Liveness + readiness, toolchain versions, no secret values

components/
  Workspace.tsx         Brief composer, source view, exports view
  Pipeline.tsx          Stage progress, activity log, error panel
  Viewers.tsx           Schematic / PCB / 3D, client-only, dynamically imported
  CommandPalette.tsx    Keyboard path to every action
  Zero.tsx              The mascot, a state machine over a pixel map
  zero-sprite.ts        The pixel data
  pixel-font.ts         5x7 font, shared by the sprite and the icon generator

lib/
  checks.ts             The check engine: severity, connectivity, fab, decoupling
  retrieval.ts          BM25 over the knowledge index
  schemas.ts            Request, export, history contracts
  schemas/brief.ts      The design brief and its JSON Schema
  errors.ts             The error taxonomy, friendly messages, HTTP statuses
  design.ts             DesignResult, DesignStats, the SSE event union
  board-colors.ts       Swatches, and direct contrast selection
  rate-limit.ts         (server/rate-limit.ts) in-process or Upstash

lib/server/
  env.ts                Validated environment; the only place env is read
  pipeline.ts           The five stages, the repair loop, the cache key
  parts.ts              Optional part-search tool
  knowledge.ts          Retrieval, cached, with a degraded fallback
  knowledge-index.json  Generated: 156 chunks, 2,260 terms, from @tscircuit/props@0.0.656
  llm/client.ts         The only place a Fireworks request is made
  llm/prompts.ts        System prompts
  compile/sandbox.ts    Static safety pass, then the child process
  checks/fab-presets.ts Fabrication capability tables, each with a source and a date
  exports.ts            Gerbers, BOM, PnP, the ZIP, the manifest
  store.ts              Permalink and gallery storage
  converters.ts         The vendored converter calls

designs/golden/         23 boards, each compiled and hashed
evals/                  40 cases; 24 run without a key
scripts/                Asset generation, index generation, probes, the secret scanner
tests/                  unit · integration · golden · e2e
docs/                   This file, and the ones next to it
```

## Boundaries

**`lib/` never imports from `lib/server/`.** The other way round is fine. A client component
that reaches for a server module gets a build error, not a runtime one.

**`lib/server/env.ts` is the only place `process.env` is read.** Everything else takes a
validated `ServerConfig`. This is what makes "the key never reaches the browser" a structural
property rather than a habit, and it is checked by `scripts/verify-no-secrets.mjs`.

**`lib/server/llm/client.ts` is the only place a Fireworks request is made.** The timeout,
the retry policy, the `finish_reason` handling, the JSON extraction, the error taxonomy and
the redaction all live in one file, and all of them are tested in one place.

**The sandbox is a child process, not a Worker.** Workers share the address space of the
server they run in; a process does not. `assertSafeGeneratedCode` is checked first because a
list a reviewer can read is worth more than a sandbox alone, and the memory cap and wall
clock are there because a list is not enough.

## Toolchain

Pinned in `lib/server/versions.ts` and reported by `/api/health`:

| Package | Version |
| --- | --- |
| `@tscircuit/eval` | 0.0.1401 |
| `@tscircuit/checks` | 0.0.191 |
| `circuit-json` | 0.0.490 |
| `@tscircuit/circuit-json-to-gerber` | 0.0.106 |
| `@tscircuit/circuit-json-to-bom-csv` | 0.0.17 |
| `@tscircuit/circuit-json-to-pnp-csv` | 0.0.13 |
| `@tscircuit/3d-viewer` | 0.0.598 |
| `@tscircuit/pcb-viewer` | 1.11.394 |
| `@tscircuit/schematic-viewer` | 2.0.92 |
| Node | v22.22.3 |

Publishing them from the health endpoint is not decoration: `@tscircuit/*` is pre-1.0, its
output is not stable across versions, and a bug report that cannot name a version cannot be
reproduced.

## Why the pieces exist

The full argument is in `docs/DECISIONS.md`. In one line each:

- **Retrieval is BM25 over the installed package source** because the failure that matters is
  a near-miss identifier — `maxResistance` versus `resistance` — and a lexical index over
  the actual declarations gets that right where topic similarity does not.
- **The golden designs are compiled** because six of the first twenty-three did not, and
  every failure was a fact about tscircuit that reading the source had not made obvious.
- **The default fab preset is the intersection of three fabs** because "verified" is a
  promise to someone about to spend money.
- **The static safety list runs before the sandbox** because a list a reviewer can read is
  worth more than a sandbox alone — and the wall clock is still there, because a list is not
  enough.
