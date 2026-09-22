# pcb-copilot — Code organization

A single-purpose Next.js app: describe a PCB, have Fireworks write real
tscircuit TSX, compile + verify it, visualize it, and export a manufacturing
bundle once ERC/DRC passes.

## Directory structure

```
├── app/
│   ├── layout.tsx            Root layout (metadata, self-hosted Geist fonts)
│   ├── page.tsx              Main page — wires chat + viewers + design state
│   ├── globals.css           Tailwind 4 theme (light/dark tokens)
│   └── api/
│       ├── design/route.ts   POST /api/design — NDJSON-streamed agent run
│       └── export/route.ts   POST /api/export — verified manufacturing ZIP
├── components/
│   ├── CircuitViewer.tsx     Tabs: schematic / PCB / 3D / source + checks
│   ├── PromptChat.tsx        Engineering brief chat + submit
│   ├── PcbView.tsx           2D PCB viewer (dynamic, client-only)
│   ├── SchematicView.tsx     Schematic viewer (dynamic, client-only)
│   ├── ThreeDView.tsx        3D assembly viewer (dynamic, client-only)
│   └── ui/                   base-ui / shadcn primitives
├── lib/                      Shared, environment-agnostic modules
│   ├── chat.ts               Chat message types
│   ├── design.ts             Design / verification / stream event types
│   ├── schemas.ts            Zod schemas shared by client + server
│   ├── exports.ts            Manufacturing bundle filename + response builder
│   ├── rate-limit.ts         In-memory sliding-window rate limiter
│   ├── utils.ts              cn() class merge helper
│   └── server/               Server-only (imports 'server-only')
│       ├── config.ts         Env/model discovery (FIREWORKS_API_KEY, MODEL_ID)
│       ├── fireworks.ts      Fireworks chat-completions client
│       ├── prompts.ts        Generator/repair system prompt
│       ├── brief.ts          Analyze requirements → DesignBrief (JSON schema)
│       ├── generation.ts     Initial code generation + repair, TSX extraction
│       ├── verification.ts   compile + ERC/DRC checks → VerificationResult
│       └── agent.ts          createVerifiedDesign() repair loop
```

## Request flow

1. **`POST /api/design`** validates input, rate-limits, then streams NDJSON events:
   - `stage` — progress markers
   - `clarification` — critical questions before routing
   - `result` — compiled + verified `DesignResult`
   - `error` — terminal failure message

2. **Agent loop** (`lib/server/agent.ts`): generate TSX → compile & run
   `@tscircuit/checks` → repair with diagnostics feedback up to
   `MAX_REPAIR_ITERATIONS` → return verified or best-effort design.

3. **`POST /api/export`** re-compiles + verifies the TSX; on success builds a
   ZIP with Gerber/Excellon, BOM CSV, pick-and-place CSV, circuit JSON, the
   TSX source, and a verification report.

## Configuration

Copy `.env.local.example` to `.env.local` (gitignored) and set:

```bash
FIREWORKS_API_KEY=...            # required
FIREWORKS_MODEL_ID=...           # optional override
```

The key is read from the environment first, then `.env.local` as a fallback.
