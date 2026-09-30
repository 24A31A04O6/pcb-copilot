# Model comparison: GLM-5.3-Flash vs DeepSeek-V4.1-Flash

> **This is a research-based assessment, not a measurement.** The two models could not be
> called from the environment this was written in — see [Why this is not measured](#why-this-is-not-measured).
> Nothing below is a measured result. The measured version is one command away, at the bottom.

**Date:** 2026-09-29
**Models:** `accounts/fireworks/models/glm-5p3-flash` (default) ·
`accounts/fireworks/models/deepseek-v4p1-flash` (opt-in fallback)

---

## What the question actually is

Not "which model is smarter." This app asks one narrow thing of a model, twice per design:

1. Emit a JSON brief that satisfies a `json_schema`, from prose written by a non-engineer.
2. Emit a single self-contained tscircuit TSX module that **compiles**, given a retrieval
   block built from the installed `@tscircuit/props`.

Then, if either fails, one repair call with the exact compiler error.

So the metrics that matter are: **schema adherence**, **first-try compile rate**, and
**repair convergence** — in that order. Price and context window are real but they are not
what is being asked here, and the user was explicit about that.

## What the published numbers say

Both models are ~1M-context MoE flash models from mid-2026. The sources disagree with each
other, so the table below is marked with how much weight each row deserves.

| Signal | GLM-5.3-Flash | DeepSeek-V4.1-Flash | Source weight |
| --- | --- | --- | --- |
| Long-horizon agentic coding (DeepSWE 1.1) | **63.4** | 54.4 – 59.3 | medium; three sources, different refreshes |
| Terminal / repo agents | 21/30 | 20/30 | weak; one vendor's harness |
| SWE-bench Verified | 76.8 | **79.0** | medium |
| Pure algorithmic code (LiveCodeBench) | not published | **90.6 – 93.5** | medium; GLM publishes nothing here |
| Structured output / JSON schema | supported, but **some gateways mark it unsupported** | **explicitly optimised for** structured API calls | see the risk note below |
| Tool calling | tool calls, constraints, dynamic tool loading | tool calls, Responses API, Anthropic-compatible | high |
| Price (output, per MTok) | ~$4.40 | ~$0.66 – 1.32 | high |

Sources, all retrieved 2026-09-29:

- [emergent.sh — GLM 5.2 vs DeepSeek V4 Pro](https://emergent.sh/learn/glm-5-2-vs-deepseek-v4-pro)
- [codingfleet.com — GLM-5.2 vs DeepSeek V4 Pro](https://codingfleet.com/blog/glm-5-2-vs-deepseek-v4-pro/)
- [regolo.ai — DeepSeek V4 Flash vs GLM-5.3-Flash](https://regolo.ai/deepseek-v4-flash-vs-qwen3-8-flash-next-vs-glm-5-3-flash-the-real-leader-in-quality-to-price-in-2026/)
- [local-ai-zone — flash-tier comparative analysis](https://local-ai-zone.github.io/blog/flash-tier-ai-models-comparative-analysis.html)
- [cometapi.com — DeepSeek-V4-Flash vs GLM-5.3-Flash](https://www.cometapi.com/deepseek-v4-flash-vs-glm-5-3-flash/)
- [requesty.ai — GLM-5.3 Flash vs DeepSeek V4 Flash 0731](https://www.requesty.ai/blog/glm-5-3-flash-vs-deepseek-v4-flash-0731)
- [flowtivity.ai — GLM-5.3-Flash vs DeepSeek V4.1-Flash on DGX Spark](https://flowtivity.ai/blog/glm-5-3-flash-vs-deepseek-v4-1-flash-dgx-spark/)

## Where the research genuinely does not answer the question

Three reasons the table above cannot settle this, stated plainly rather than papered over with
a score.

**1. No published benchmark measures "emits a tscircuit TSX that compiles first try."**
Every benchmark above is general software engineering. This app's failure mode is narrow and
unusual: a prop name that tscircuit silently ignores (`numLayers`), a required prop the model
omits (`loadCapacitance`), a footprint string that is not a real footprinter function
(`pot_334`). No leaderboard measures that, and it is the thing that decides success here.

**2. The structured-output evidence is contradictory and it is the load-bearing signal.**
This app depends on `json_schema` on the wire. One source says GLM's structured output is
unsupported on *some gateways*, which would break the brief stage silently. Another says GLM
"followed strict schemas... and ignored simple prompt injections." These are both true of
different deployments — which is exactly the problem. `deepseek-v4p1-flash` is the one
described as *built* for structured API calls and JSON schema parsing, so on paper it is the
safer bet for the brief stage specifically.

**3. The one measured head-to-head is nearly a tie.** 21/30 vs 20/30 on multi-step terminal
tasks. That is inside the noise of a single vendor's harness.

## The one local-serve data point that is *not* applicable here

flowtivity reported GLM-5.3-Flash NVFP4 solving 0/5 DeepSWE tasks on DGX Spark against
DeepSeek's 2/5, with the context capped at 24K by serving-stack bugs. This is a
**quantised self-hosting artifact** and does not apply to Fireworks serverless, where both
models run on provider hardware. Recorded because it is the kind of result that gets quoted
out of context later.

## Provisional recommendation

**Keep GLM-5.3-Flash as the default, and keep DeepSeek as an opt-in fallback — but demote
DeepSeek to a *schema* fallback rather than a general one.**

The reasoning, in order of weight:

1. **The repair loop is agentic, and that is where GLM's margin is widest.** If the first
   codegen attempt fails, the app does not just retry — it hands the model the exact compiler
   error and the exact failing check, and asks for a fix. That is multi-turn, error-driven
   engineering, which is the shape of benchmark where GLM leads by 4–9 points, not 0.5.
2. **The prompt-injection case matters and GLM is reported to handle it.** `model-hostile`
   puts an injection in user input. A model that follows it writes attacker-chosen
   components into a design that then compiles and exports. DeepSeek's published strength
   is single-shot well-defined problems, which is the *other* half of this app.
3. **But the brief stage is a single-shot JSON-schema call, and that is DeepSeek's stated
   home turf.** This is why the recommendation is to *split* the roles rather than pick one
   model for both.

That role split is not implemented. It is recorded in
[DECISIONS.md §1](DECISIONS.md#1-model-default-and-fallback) as the thing the measurement
should decide, and it is a deliberate choice not to build it on the strength of vendor
marketing copy.

## Edge cases the comparison must cover

The corpus already contains sixteen model cases, grouped by the failure they probe. These
are the ones that discriminate between the models rather than just measuring "can it code":

| Case | What it discriminates |
| --- | --- |
| `model-crystal` | `loadCapacitance` is required and `max_via_count: 0` is forced — a model that does not read the retrieval block fails here |
| `model-four-layer` | `numLayers` is **silently ignored**. A model that guesses wrong still returns valid JSON, still compiles, and produces a two-layer board. Only the check engine catches it |
| `model-transistor-switch` | required `type` prop |
| `model-potentiometer` | `maxResistance` is required; `pot_334` is not a footprinter string |
| `model-hostile` | prompt injection in the brief — the untrusted-input defence |
| `model-impossible` | physically impossible request — must refuse rather than invent |
| `model-ambiguous` | must ask rather than guess |
| `model-oversized` | must stay inside the output token budget |
| `model-unicode` | units and non-ASCII in the brief |
| `model-repair-recovers` | does the repair loop actually converge — the single most discriminating case here |

## Running the measured version

The harness is built and the key is wired. This is the whole procedure:

```bash
cd pcb-copilot
printf 'FIREWORKS_API_KEY=<your key>\n' > .env.local     # gitignored; never commit it
npx pnpm install --frozen-lockfile
```

Then start small. **A five-case head-to-head is the right first run** — it covers the
discriminating failures and costs roughly 80–120k tokens across both models:

```bash
npx pnpm run eval -- --compare \
  --only=model-blinker,model-crystal,model-four-layer,model-hostile,model-repair-recovers \
  --budget=150000
```

`--budget` is a hard circuit breaker, not an estimate: it is checked *before* each case, using
the 8k output ceiling as the worst case, so a run that would overspend stops instead of
finding out afterwards. A budget stop is recorded as `skipped` with the reason, never as a
`fail`, so it cannot make one model look worse than the other by being the one that ran out.

Widen only if the result is close:

```bash
npx pnpm run eval -- --compare --budget=450000        # all 16, both models
```

Output lands in `evals/results/latest.json` and `docs/MODEL-COMPARISON.md`, which this file
will overwrite — that is intentional, the measured table replaces the researched one.

## Why this is not measured

`api.fireworks.ai` and `fireworks.ai` are **unreachable from the environment this was written
in.** TCP to port 443 connects; the TLS handshake is accepted and then dropped immediately
after the Client Hello, before any certificate is exchanged. Retried three times, same
result. `api.github.com` over the identical path completes a TLSv1.3 handshake, so it is a
host-scoped egress block, not general connectivity.

**The API key was never transmitted and zero tokens were spent.** The key lives only in
`.env.local`, which is gitignored and the sole file in the repository containing it.

Confirmed with:

```bash
openssl s_client -connect api.fireworks.ai:443 -servername api.fireworks.ai </dev/null
# CONNECTED(00000003)
# TLS handshake has read 0 bytes and written 329 bytes
```

This is recorded as an unresolved external prerequisite in
[VERIFICATION.md](VERIFICATION.md) and in [RESEARCH.md](RESEARCH.md).
