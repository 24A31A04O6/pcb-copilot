# Decisions

Each entry says what was decided, what it cost, and what would make it wrong. A decision
record that only lists the winner is a changelog.

---

## 1. GLM 5.3 Flash as the primary model, DeepSeek V4.1 Flash as the fallback

**Decided.** `accounts/fireworks/models/glm-5p3-flash` by default, with
`deepseek-v4p1-flash` available behind `ALLOW_FALLBACK_MODEL`.

**Why.** GLM is serverless, supports function calling, and has a 1M context. DeepSeek is
roughly a third of the price, which matters when a design is regenerated five times in a
revision loop. Both are pinned, never aliased.

**Cost.** Two models means two failure modes, and the fallback path is only exercised when a
key is present.

**Wrong if.** DeepSeek turns out to win on TSX quality as well as cost. `pnpm run eval --
--compare` exists to answer exactly that, and `docs/MODEL-COMPARISON.md` is its output. Until
it has been run with a key, this decision rests on price and context length, not on
measured quality.

---

## 2. The fallback model is for availability, never for a design that failed to parse

**Decided.** `callStructured` order is: primary call → defensive extraction → **one** repair
call with the exact validation errors → one fallback call → a typed error. A design that
came back as prose gets a repair call, not a different model.

**Why.** The original failure this app was built to fix was a model that answered a JSON
brief request with an essay. Swapping models at that moment hides the problem and doubles
the cost of a bug the user cannot see. One repair call total, not one per model, is the bound.

**Cost.** A brief the primary model persistently cannot satisfy fails rather than being
rescued by a second opinion.

---

## 3. No `json_schema` on the code-generation stage

**Decided.** The brief stage uses `response_format: { type: "json_schema" }`. The TSX stage
does not, and parses defensively with brace-aware extraction.

**Why.** Fireworks disables reasoning when `json_schema` is set, and reasoning is what makes
the TSX good. Trading output quality for a parse convenience on a stage whose output is
*code* — which is extracted by a fence scanner anyway — is a bad trade.

**Wrong if.** Measured eval data shows the TSX stage is the one failing to parse. It has not
been measured yet, for want of a key.

---

## 4. Board colour is applied to Circuit JSON, not to the viewer

**Decided.** Picking a swatch rewrites `solder_mask_color` on the `pcb_board` element in the
Circuit JSON, and the recoloured JSON is what the 2D viewer, the 3D viewer, the Gerber export
and the manifest all receive.

**Why.** Recolouring the viewer alone produces a pretty picture and a green board at the fab.
Colour is a property of the design, so it belongs in the data.

**Cost.** A recolour clones the element array. That is a shallow copy of a few hundred
objects, which is cheap next to a compile, and it happens once per swatch click.

---

## 5. Solder mask colour is passed as hex, not as a tscircuit preset name

**Decided.** `solderMaskColor="#17325C"` rather than `solderMaskColor="blue"`.

**Why.** Read from the installed `@tscircuit/3d-viewer@0.0.598`: `resolveSoldermaskColor()`
accepts preset names *and* CSS hex/RGB/HSL, and feeds both the substrate colour and the mask
texture. The default was changed upstream from neon green to subdued FR-4 greens in
tscircuit/core#3938, so a preset name would give whichever green they chose that month.
A hex gives a specific, reviewable colour.

**Wrong if.** A future viewer release stops honouring hex. The `soldermask-reaches-the-board`
eval and the `soldermask-colour` golden both fail loudly if the field stops reaching
`pcb_board`.

---

## 6. Part search is optional, configurable, and reported when absent

**Decided.** The `search_parts` tool is offered only when both `WEB_SEARCH_ENABLED` and
`PART_SEARCH_URL` are set. The system prompt says which world the model is in **either
way**. Every design carries `partSearchUsed`, and the exports view says plainly when a run
had no catalogue behind it.

**Why.** An invented manufacturer part number is indistinguishable from a real one in a BOM.
The two failure modes — a tool that fails, and a model that guesses — are both made
explicit rather than left to chance.

**Cost.** With no backend configured the tool is dead weight in the configuration surface.

**Known gap.** There is no open, self-serve parts-search API a serverless function can rely
on: SnapMagic sells its Search API by request and does not publish the contract, and
Octopart/Nexar requires an approved application. Rather than invent a vendor shape, the
endpoint is configurable. **This is the one feature in the app that has not been executed
against a real backend.** See `docs/RESEARCH.md` and `docs/VERIFICATION.md`.

---

## 7. Retrieval is BM25 over the installed package source, not embeddings

**Decided.** `lib/server/knowledge-index.json` is built by extracting prop documentation
from the installed `@tscircuit/props@0.0.656` at build time and merging it with three
hand-written notes. Ranking is BM25 with an identifier boost.

**Why.** The failure mode that matters here is a model writing `maxResistance` when the prop
is `resistance`, or `numLayers` when it is `layers`. A lexical index over the actual prop
declarations answers those questions exactly. Embeddings would rank by topic similarity and
still get a near-miss identifier wrong. It also runs with no network, no model call, and no
API key, so it cannot be the reason a design fails.

**Cost.** A question phrased with none of the source's vocabulary returns nothing. The
identifier rule makes that a safe failure: if every query term is an identifier the corpus
defines, chunks that merely mention it are dropped rather than padded into the prompt.

---

## 8. Unused connector pins warn; floating pins on two-terminal parts block

**Decided.** `lib/checks.ts` raises a blocking `floating_pin` for a part with no spare pins
(a resistor, a capacitor, a diode…) and a non-blocking `unused_connector_pin` for a header or
IC pin that was never traced.

**Why.** Both cases passed every check tscircuit runs. The first one is a dead board: a
resistor with one leg in the void compiles, routes, and would have been exported as
"verified". The second one is a decision: you buy a 20-way header and use two of it. A gate
that blocks both is a gate users route around.

**Wrong if.** A user genuinely wants a spare pin on a two-terminal part — for a rework point,
say. There is no way to express that today. The honest fix is an explicit opt-out, not a
weaker check.

---

## 9. The fabrication gate is the intersection of the fabs, not the best of one

**Decided.** `prototype-hobby-2layer` is the default preset: 0.2 mm trace and space, 0.4 mm
drill, 0.5 mm board-edge clearance, two layers. The JLCPCB and PCBWay presets are available
and looser.

**Why.** "Verified" is a promise to someone who is about to spend money. A design that
passes the intersection passes everywhere; one that passes only JLCPCB's economy tier has
been promised something the next fab will reject.

**Cost.** Denser designs are blocked until the user picks a preset. That is the correct
place for the friction — in the choice, made explicitly, rather than in a rejection.

---

## 10. Golden designs are compiled, not pattern-matched

**Decided.** All 23 designs in `designs/golden/` run through the real sandbox on every
`GOLDEN=1` run and are hashed.

**Why.** Six of the first drafts did not compile, and every failure was a fact about
tscircuit that no amount of reading the source had made obvious: `loadCapacitance` is
required, `maxDecouplingTraceLength` exists and is needed, a crystal forbids vias, `layers`
is not `numLayers`. Those are now the corpus.

**Cost.** The suite takes about 55 seconds and one worker. It is opt-in, not part of
`pnpm test`.

---

## 11. A tscircuit upgrade is a reviewed diff, not a version bump

**Decided.** Every golden carries a SHA-256 of its canonical Circuit JSON.
`pnpm run golden:hash` regenerates them and prints drift.

**Why.** `@tscircuit/*` is pre-1.0 and its output is not stable across versions. A pin
renumbering or a changed autorouter is a real design change that deserves a human to look at
it, and a hash is the smallest thing that forces that.

**Wrong if.** A patch release is genuinely cosmetic. Then the hashes churn and the review
becomes theatre. The escape hatch is to review the diff once and accept it; the cost is that
one review.

---

## 12. Untrusted model output is checked twice, statically and then dynamically

**Decided.** `assertSafeGeneratedCode` refuses imports, re-exports, `require`, `eval`,
`new Function`, `process`, `globalThis`, DOM access, `fetch`, network APIs, timers,
`while (true)`, `for (;;)`, prototype access, `Buffer`, `import.meta`, `with` and `debugger`
— after stripping comments, so a note in a comment cannot smuggle a pattern past it. Then the
module runs in a child process with a wall clock and a memory cap, with `fetch` removed.

**Why.** The static pass is a cheap, legible list a reviewer can read. The dynamic pass
catches what a list cannot — a `for (let i = 0; i < 1e15; i++)` loop that looks innocent and
is not. The `sandbox-timeout` eval exists specifically to measure the second one.

**Wrong if.** A generated module legitimately needs something on the list. Then the list
needs an entry, reviewed, not removed.

---

## 13. A failing eval is a change in the code, not in the expectation

**Decided.** Eval cases declare what a *correct* answer looks like. When one fails, the
first assumption is that the code is wrong.

**Why.** The alternative — updating a golden when it goes red — converts the suite into a
recorder of current behaviour, which passes forever and catches nothing. Every one of the
three production bugs found in this phase was found because a case was written from the
specification and the code disagreed with it.

**Cost.** A deliberate behaviour change requires editing the case, which is exactly the
moment the change should be written down.

---

## 14. The secret scanner prefers a false negative it can explain to a false positive it cannot

**Decided.** `scripts/verify-no-secrets.mjs` matches provider-shaped credentials, plus one
generic literal rule: length ≥ 24, no whitespace, mixed case, a digit, entropy ≥ 3.6.
Comments are stripped first. It never prints a full value.

**Why.** The first version keyed on the word "key" appearing near a long string and flagged
four of this repository's own error messages. The second flagged documentation quoting a
package name. A scanner that cries wolf gets switched off, and a switched-off scanner is
worse than none. Each rule now carries the reason it exists. It was validated by planting
three real leaks and confirming each is caught.

**Known limit.** A low-entropy secret — an all-lowercase passphrase — will pass. Entropy
cannot tell a weak key from a hash. The named patterns are the real defence; the generic rule
is a net for the case where someone pastes a token into a file they did not think of as
code.
