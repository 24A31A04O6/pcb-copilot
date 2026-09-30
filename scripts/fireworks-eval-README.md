# Fireworks model eval — quick notes

Zero-dependency harness to compare two Fireworks models for pcb-copilot on the
two jobs the app actually does (JSON-schema design briefs + tscircuit TSX
codegen) plus edge cases, with a **hard token budget**.

## Run it

```bash
# CLI (works anywhere; reads FIREWORKS_API_KEY from env or .env.local)
node scripts/fireworks-eval.mjs                 # default budget 50k tokens
node scripts/fireworks-eval.mjs --budget=20000  # stricter
node scripts/fireworks-eval.mjs --model-a=accounts/fireworks/models/xxx \
    --model-b=accounts/fireworks/models/yyy     # any pair
node scripts/fireworks-eval.mjs --mock          # self-test, spends 0 tokens

# Browser harness (needed in sandboxes where api.fireworks.ai is firewalled)
node scripts/fireworks-eval-server.mjs          # then open the served page
```

Typical full-suite usage: ~10–15k tokens (2–3% of a 500k budget). The budget
guard aborts *before* exceeding the cap — it never overspends.

## Suite (7 cases × 2 models)

| case | kind | what it probes |
|---|---|---|
| B1-clear-spec | brief | valid JSON, schema fields, `status: ready` |
| B2-vague-ambiguous | brief | must return `needs_clarification` + questions |
| B3-off-topic-injection | brief | prompt-injection + unicode/quotes survive, stays in role |
| G1-simple-led | codegen | TSX shape, components, traces, footprints, no forbidden APIs |
| G2-usb-lipo-rules | codegen | app-specific rules (ESD, CC resistors, charger, decoupling) |
| G3-impossible-spec | codegen | 10A through 0402 — pushes back / handles current, doesn't silently obey |
| G4-unicode-quotes | codegen | extraction integrity with Ω, ±, quotes in the spec |

Scoring is structural (regex-level): real compile/ERC/DRC verification happens
in the app via `@tscircuit/checks`. Treat scores as comparative, not absolute.

## Pricing (Fireworks serverless, verified Sep 2026)

| model | $/1M in | $/1M out | est. per full board run\* |
|---|---|---|---|
| deepseek-v4-flash | $0.14 | $0.28 | ~$0.0016 |
| deepseek-v4-pro | $1.74 | $3.48 | ~$0.020 |

\* brief + codegen + 1 repair ≈ 3.9k in / 3.7k out tokens. Pro is ~12× the
cost per board. 500k tokens ≈ $0.09 on flash vs ≈ $1.13 on pro.

## Recommendation (see run output for live scores)

Keep **deepseek-v4-flash** as the default `FIREWORKS_MODEL_ID` unless the live
run shows a real gap on B2/G3:

- The app is self-correcting: `agent.ts` re-prompts with compile/ERC/DRC
  diagnostics up to 3×, so a cheap model's mistakes are fixed mechanically —
  one extra repair pass on flash is still ~5× cheaper than pro.
- The task is pattern-heavy (fixed tscircuit DSL), not open-ended reasoning —
  exactly the flash tier's sweet spot.
- If pro only wins on edge cases (G2/G3), use a hybrid: flash for briefs +
  repairs, pro for the initial codegen call only (~3× run cost instead of 12×).

If the pair to compare isn't flash vs pro, pass `--model-a/--model-b`.
