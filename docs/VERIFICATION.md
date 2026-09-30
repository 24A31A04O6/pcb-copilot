# Verification report

**Date:** 2026-09-29
**Commit range:** `59f0cf1` → `e8c2c46` on `arena/01a0eb74-pcb-copilot`
**Toolchain:** Node v22.22.3 · `@tscircuit/eval@0.0.1401` · `@tscircuit/checks@0.0.191` ·
`circuit-json@0.0.490`

---

## Commands executed, and their results

Every command below was run in this repository. Nothing is quoted from memory.

| Command | Result |
| --- | --- |
| `npx eslint . --max-warnings=0` | **0 errors, 0 warnings** |
| `npx tsc --noEmit` | **clean** |
| `npx vitest run tests` | **12 files, 225 tests passed** |
| `GOLDEN=1 npx vitest run tests/golden` | **117 tests passed** (23 designs × 5 assertions + 2 corpus assertions) |
| `npx next build` | **succeeded** — 8 routes, manifest prerendered |
| `node scripts/verify-no-secrets.mjs` | **no credentials found** (2 high-entropy strings flagged for a human look, neither a credential) |
| `npx tsx evals/run.ts` | **24 offline passed, 0 failed, 16 model cases skipped (no `FIREWORKS_API_KEY`)** |
| `npx tsx scripts/golden-hash.ts` | **23 designs, all pass the fabrication gate** |

### The golden corpus, board by board

All 23 compiled and cleared the gate on the last run:

```
rc-led-blinker  rc-filter  voltage-divider  ldo-breakout  transistor-switch
crystal-oscillator  diode-rectifier  dip-switch  usb-power-breakout
sot23-led-driver  two-layer-power  potentiometer  testpoint-farm  inductor-buck
four-layer-controller  soldermask-colour  wide-header  stack-of-passives
led-matrix-row  rc-network  regulator-with-enable  i2c-sensor  motor-driver
```

### Coverage of the test suite

| Suite | Tests | What is real about it |
| --- | --- | --- |
| Unit | 80 | Pure functions; connectivity, severity, extraction, schemas, retrieval, part search |
| Fireworks integration | 37 | MSW, asserting the exact wire body |
| Sandbox integration | 29 | The real `@tscircuit/eval` in a real child process |
| Export gate | 13 | The real gate, rate limits reset between requests |
| Retrieval integration | 19 | The shipped index, scored against real questions |
| Golden | 117 | 23 real boards, compiled and hashed |

---

## Three production bugs the eval suite found

Written before the fixes, recorded here because "we wrote more tests" is not the claim.

### 1. `extractTsx` kept the prose it was meant to drop

`lib/server/pipeline.ts`. The function decided whether text before `export default` was code
by **counting lines**. A one-line "Sure! Here is your design." is one line, so it was kept —
and a sentence ended up inside the module, which then failed to compile with a message about
the wrong thing.

It now keeps a line only if it *starts like a declaration*. Case: `extract-prose-before-code`.

### 2. A two-terminal part with a leg in the void passed every check

`lib/checks.ts`. tscircuit's `source_pin_must_be_connected_error` does not fire for a
resistor wired on one side and to nothing on the other. The board compiled, routed, produced
Gerbers, and the app would have marked it **verified**.

`lib/checks.ts` now has a connectivity pass. A part with no spare pins (resistor, capacitor,
diode, transistor, crystal…) raises a blocking `floating_pin`. A header or IC pin that was
never traced raises a non-blocking `unused_connector_pin`, because buying a 20-way header and
using two of it is a decision, not a bug.

Cases: `gate-blocks-floating-pin`, `gate-allows-spare-connector-pins`.

### 3. Every check message named pins instead of parts

`lib/checks.ts`. The component-name map was built by reading `source_component_id` and
`name` off *every* element. A `source_port` has both — `name` is the pin name — so the last
port in the array overwrote its own component, and every message in the report read
"pin2 pin pin2 is not connected to anything".

This was live in the app, not only in the tests. The map now reads `source_component` and
`pcb_component` only. Case: `names the part, not the pin`.

---

## Six tscircuit facts the golden corpus found

Each of these made a design fail to compile, and each is a fact about the installed
packages rather than about the documentation.

| Fact | Consequence |
| --- | --- |
| The board layer prop is `layers`, not `numLayers` | `numLayers={4}` is **silently ignored**; a "four-layer" board compiled as two layers and passed every check |
| `<potentiometer>` requires `maxResistance`; the wiper is `pin2` | `resistance` and `.wiper` both fail |
| `<transistor>` requires `type`; `<crystal>` requires `loadCapacitance`; `<mosfet>` requires `mosfetMode` | Component creation fails |
| `pot_334` is not a footprinter string; the function is `potentiometer` | `Invalid footprint function, got "pot"` |
| A capacitor between a power-named pin and ground is capped at **1 mm** of trace | tscircuit refuses to route; `maxDecouplingTraceLength` is the override |
| A crystal forces `max_via_count: 0` on its traces | A load-cap network that crosses itself cannot be routed at all |

The first one is the dangerous kind: `numLayers` does not fail, it just quietly does nothing.

---

## Security controls, and how each was checked

| Control | How it was verified |
| --- | --- |
| Secret scanner | **Three real leaks planted** — a Fireworks key, an env read in a component, a bare high-entropy literal. All three caught. Repository is clean. |
| Static code safety list | 29 sandbox tests; the list is documented and readable |
| Compile wall clock | The `sandbox-timeout` eval compiles a loop that passes the static check and confirms the clock stops it |
| Memory cap | The `sandbox-memory-cap` eval compiles a 100-part board at the default 768 MB |
| Env isolation | `lib/server/env.ts` is the only reader of `process.env`; the scanner fails the build on a server-only read from client code |
| Log redaction | Asserted in the Fireworks suite: the test key never appears in a log line |
| Security headers | Asserted in `tests/e2e/health.spec.ts`; **not executed here** (see below) |
| Export gate | 13 tests; the gate is server-side, so a disabled button proves nothing |
| Health endpoint | Reports configuration and toolchain versions, names a missing variable, never prints a value |

## What has **not** been verified

This is the part that matters. None of the following was executed, and nothing in this
repository claims otherwise.

1. **No live Fireworks call has been made.** A key was supplied and confirmed to reach the
   code — `pnpm run eval -- --model` loads it from `.env.local` and the pipeline starts — but
   `*.fireworks.ai` is **unreachable from this environment**: TCP to :443 connects and the TLS
   handshake is dropped immediately after the Client Hello. Retried three times. GitHub over
   the identical path completes a TLSv1.3 handshake, so it is a host-scoped egress block.
   **The key was never transmitted and zero tokens were spent.** The sixteen model eval cases
   report `skipped`. Every stage from the brief onwards is covered by MSW and by the goldens —
   not by a real model. The comparison in [MODEL-COMPARISON.md](MODEL-COMPARISON.md) is
   therefore a *researched* assessment, labelled as such, with the measured version one
   command away.
2. **The model comparison has not been measured.** `docs/MODEL-COMPARISON.md` exists and is
   explicit that it is a researched assessment, not a result. The decision to make GLM the
   default rests on published benchmarks, price and context length — not on this app's
   actual success rate. `pnpm run eval -- --compare --budget=150000` measures it in about
   five cases; it has not been run here for the network reason above.
3. **The browser suite has never run.** The Playwright CDN refused the Chromium download
   (`ECONNRESET` / TLS disconnect). The specs are written, type-checked, linted and wired
   into CI, but they have not executed — and the visual baselines do not exist, so the first
   CI run will create them rather than compare against them.
4. **The part-search tool has never been run against a real backend.** There is no open,
   self-serve parts API a serverless function can rely on; SnapMagic sells access by request
   and does not publish the contract. The tool, the loop, the timeouts and the error path
   are tested; the vendor binding is a configurable URL. Every design produced without it
   says so.
5. **The app has not been deployed.** `vercel.json` sets `maxDuration: 300` for
   `/api/design`; whether that is accepted depends on the plan.
6. **Fab capability tables have not been confirmed with a fab.** Each preset cites a
   published source and the date it was checked. None has been validated by sending a real
   order.
7. **The tscircuit playground URL has not been opened in a browser.** The parameter name came
   from a documentation snippet.
8. **Rate limits are conservative, not researched.** No per-key tier table is public, so the
   limiter ships with local limits and an optional Upstash backend rather than a number it
   cannot cite.

---

## Deploying

### 1. Provision

- A Vercel project (or any Node 22 host that can run `next start`).
- A Fireworks API key from <https://fireworks.ai/api-keys>.

### 2. Configure

Set these as **server-side** environment variables. None is `NEXT_PUBLIC_`.

| Variable | Required | Value |
| --- | --- | --- |
| `FIREWORKS_API_KEY` | **yes** | your key |
| `FIREWORKS_MODEL` | no | `accounts/fireworks/models/glm-5p3-flash` (default) |
| `FIREWORKS_FALLBACK_MODEL` | no | `accounts/fireworks/models/deepseek-v4p1-flash` |
| `ALLOW_FALLBACK_MODEL` | no | `1` to enable the fallback |
| `FIREWORKS_CODEGEN_MAX_TOKENS` | no | `8000` default; this is what decides truncation |
| `COMPILE_TIMEOUT_MS` | no | `30000` default |
| `COMPILE_MEMORY_MB` | no | `768` default |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | both or neither; without them rate limiting is per-instance |
| `TURNSTILE_SITE_KEY` / `_SECRET_KEY` | no | bot protection; the health endpoint reports when it is off |
| `SENTRY_DSN` | no | server error reporting |
| `PART_SEARCH_URL` / `WEB_SEARCH_API_KEY` | no | part search; off by default |

`vercel.json` already sets `maxDuration: 300` and `memory: 1024` for `/api/design` and
`maxDuration: 120` for `/api/export`. A design takes tens of seconds end to end; a cold
compile of a large board is the worst case.

### 3. Deploy

```bash
vercel --prod
```

Vercel builds with `pnpm install --frozen-lockfile && pnpm run build`. The knowledge index is
committed, so no build-time package resolution is needed.

### 4. Verify, in this order

```bash
curl -s https://YOUR-DOMAIN/api/health | jq
```

1. **`status` is `ok`.** If it is `degraded`, `envError` names the variable that is wrong.
2. **`toolchain` matches the table above.** A different `@tscircuit/eval` means the golden
   hashes are no longer the ones you reviewed.
3. **Send a design** through the UI with a two-line brief. Watch the SSE stream: brief →
   codegen → compile → checks → done. Every stage must appear.
4. **Try to export before verification is possible**, and confirm the API refuses. The
   button being greyed out proves nothing; the route is the control.

Then, in CI, run the model evals with the key present:

```bash
pnpm run eval -- --compare
```

That produces `docs/MODEL-COMPARISON.md`, which is the input to revisiting
`docs/DECISIONS.md` §1.

### 5. Ongoing

- `pnpm run eval -- --compare` on a schedule, not on every deploy: it costs money and
  returns a different answer each time.
- `GOLDEN=1 pnpm run test:golden` before any `@tscircuit/*` bump. A changed hash is a design
  change and deserves a look.
- `/api/health` as a readiness probe. It returns 503 when the key is missing, which is what
  stops a load balancer sending traffic to a deployment that cannot answer.
