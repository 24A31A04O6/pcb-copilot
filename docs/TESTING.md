# Testing

Five layers, each answering a different question, each runnable on its own. The rule
throughout: **a test that passes without doing the work is a bug in the test.**

---

## What is actually run

| Suite | Command | Covers | Needs a key | Runs in CI |
| --- | --- | --- | --- | --- |
| Unit | `pnpm run test:unit` | Schemas, checks, JSON extraction, errors, rate limiting, board colours, ZERO sprite, retrieval, part search | no | yes |
| Integration | `pnpm run test:integration` | Fireworks wire behaviour (MSW), the compile sandbox, the export gate | no | yes |
| Evals | `pnpm run eval` | 24 offline + 16 model cases against the real compiler | no / yes | yes (offline) |
| Golden | `GOLDEN=1 pnpm run test:golden` | 23 boards compiled and hashed | no | yes |
| Browser | `pnpm run test:e2e` | Playwright, axe, visual regression | no | yes |

`pnpm run check` is the local gate: typecheck → lint → test → build.

---

## Unit tests

`tests/unit/`. Pure functions, no I/O, no clock dependence beyond what is injected.

The ones worth knowing about:

- **`checks.test.ts`** — severity classification for every element type the toolchain emits,
  and the connectivity pass. A `source_port` carries both a `source_component_id` and a
  `name`, so a naive name map lets the last port win and every message in the report names
  pins instead of parts; there is a regression test for exactly that.
- **`json.test.ts`** — brace-aware extraction from a string with braces in strings, braces in
  comments, and a truncated object. The `stripComments` test asserts the whitespace it
  leaves behind (`a  \nc   e`), because that whitespace is load-bearing for line numbers.
- **`errors.test.ts`** — every code in the taxonomy has a friendly message and a status, and
  the internal detail never appears in a client-facing message.
- **`retrieval.test.ts`** — tokenizer, BM25 ranking, the identifier boost, and the shipped
  index answering the questions a designer actually asks. The load-bearing case: no chunk may
  claim to define an identifier that does not exist in the corpus.
- **`parts.test.ts`** — the tool definition, enablement, normalisation of several vendors'
  field names, and every failure path. A backend that returns `{ error: ... }` must raise, not
  return an empty list: an empty list and a broken backend must not look the same.

## Integration tests

`tests/integration/`. These compile real tscircuit modules and stand up an MSW server that
asserts the **exact request body**, not just the parsed result.

- **`fireworks.test.ts`** (37 tests) — the wire format for `json_schema`, retry behaviour per
  status, `Retry-After`, `finish_reason: length` and the one doubled-budget retry, the
  one-repair-call bound, the one-fallback-call bound, refusal detection, and that the API key
  never reaches a log line. It exists because a proxy has been observed silently stripping
  `json_schema` from Fireworks requests (see `docs/RESEARCH.md`); asserting only the parsed
  result would not notice.
- **`sandbox.test.ts`** (29 tests) — the static safety list, the worker, the wall clock, the
  memory cap, and that CDN loading is disabled.
- **`export-gate.test.ts`** (13 tests) — the gate is server-side. It resets rate limits
  between requests, which is a real trap when the limiter is process-wide.
- **`retrieval.test.ts`** — the shipped index, scored against the questions the app asks it.

## Evals

`pnpm run eval`. 40 cases in two kinds.

**Offline (24)** run against the real compiler, the real check engine and the real retrieval
index. No key, no network, deterministic. They catch a regression *in this repository*.

**Model (16)** run the full brief → JSON → code → compile → checks pipeline against
Fireworks. They catch a regression in the *prompt*, and they cost money, so they are opt-in:

```bash
pnpm run eval -- --model       # model cases only
pnpm run eval -- --compare     # every case against both models, writes docs/MODEL-COMPARISON.md
```

Without `--model`, or without a key, the model cases report **`skipped` with the reason**.
That is deliberate and it is the most important behaviour in this file: a suite that reports
success for work it did not do is worse than no suite at all.

The offline cases found three production bugs the first time they ran. All three are
documented in `docs/DECISIONS.md`: `extractTsx` keeping prose it was meant to drop, a
two-terminal part with a leg in the void passing every check, and every check message naming
pins instead of parts.

## Golden designs

`designs/golden/designs.ts` — 23 boards, each real tscircuit source. Every one compiles,
clears the fabrication gate against its preset, has the board size and part count it claims,
and produces a byte-identical Circuit JSON across runs.

```bash
GOLDEN=1 pnpm run test:golden    # verify
pnpm run golden:hash             # regenerate hashes and print drift
```

Circuit JSON is canonicalised before hashing: object keys are sorted, and the random
ten-character ids tscircuit mints (`source_part_not_found_warning_1gZfWA7CYI`) are replaced
with a stable index. Without that, no hash would ever be stable.

A changed hash is either a deliberate `@tscircuit/*` upgrade or a regression. There is no
third option; see `docs/DECISIONS.md` §11.

## Browser, accessibility and visual regression

`pnpm run test:e2e`. Playwright against a **production build**, not a dev server.

- **Shell** — the brief form, tabs, colour swatches, history drawer, brief validation.
- **Accessibility** — axe on the empty state and on a loaded design. `critical` and `serious`
  violations fail the run. `minor` does not: a gate that reports advisories the design
  system makes deliberately is a gate people disable. Every violation is attached to the
  report so a non-failing one can still be read.
- **Visual regression** — committed baselines under `tests/e2e/__screenshots__`, 2% pixel
  tolerance, animations disabled. Review the image, then `--update-snapshots`.
- **Health and security headers** — the health endpoint must name a missing variable without
  printing its value, and every response must carry the header set in `next.config.mjs`.

The design-flow specs load a design from the store rather than generating one, and skip with
a reason unless `E2E_DESIGN_HASH` is set. Model output is non-deterministic and costs money;
that assertion belongs in `evals/`, not in a browser test.

## Secrets

`pnpm run verify:secrets` runs before everything else in CI. It matches provider-shaped
credentials, checks that no server-only env var is read from client code, checks that no
`NEXT_PUBLIC_` name looks like a secret, and confirms no `.env*` file is tracked. It never
prints a full value.

## What has not been run here

Honesty section, because a testing document that claims more than it did is worse than none.

- **The browser suite has never been executed in this environment.** The Playwright CDN
  refused the Chromium download (`ECONNRESET` / TLS disconnect). The suite is written, is
  wired into `.github/workflows/ci.yml`, and is type-checked and linted — but it has not run.
  The visual baselines in particular do not exist yet, so the first CI run will create them
  rather than compare against them.
- **The model evals have never been run**, because `FIREWORKS_API_KEY` is absent. Sixteen
  cases report `skipped`.
- **The part-search tool has never been run against a real backend.** There is no
  self-serve parts API available; see `docs/DECISIONS.md` §6.
- **No design has been generated by a model end to end** in this environment, for the same
  reason. Everything from the brief stage onwards is covered by MSW and by the goldens, not
  by a live call.
