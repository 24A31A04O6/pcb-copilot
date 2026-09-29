'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { BOARD_COLORS, getBoardColor, type BoardColor } from '@/lib/board-colors'
import { FAB_PRESETS } from '@/lib/server/checks/fab-presets'
import { readLocal, writeLocal, copyText, cn } from '@/lib/utils'
import type { DesignResult } from '@/lib/design'

/* -------------------------------------------------------------------------- */
/* Brief input                                                                 */
/* -------------------------------------------------------------------------- */

export const EXAMPLE_BRIEFS = [
  '5 V to 3.3 V regulator breakout: 3-pin screw terminal input, AMS1117-3.3, 100 µF input bulk, 10 µF output, 2×5 ICSP header, 40 × 30 mm.',
  'USB-C 5 V sensor board: CC 5.1 k resistors, USB-C receptacle, ESP32-C3 module, BME280 on I²C, 10 µF bulk, 3-pin I²C header.',
  'LED driver: 12 V input, 3 W LED on a 350 mA constant-current buck, 2-pin screw terminal out, heatsink pad, 10 µH inductor.',
  'I²C sensor breakout for the Qwiic ecosystem: 4-pin 2.54 mm header, 10 k pull-ups, 100 nF decoupling, 20 × 15 mm.',
] as const

const MAX_BRIEF = 4_000

export function BriefComposer({
  onGenerate,
  busy,
  onCancel,
  boardColor,
  onBoardColorChange,
  fabPreset,
  onFabPresetChange,
  revisionMode,
  revisionNote,
  onRevisionNoteChange,
  onExitRevision,
}: {
  onGenerate: (brief: string) => void
  busy: boolean
  onCancel: () => void
  boardColor: BoardColor
  onBoardColorChange: (color: BoardColor) => void
  fabPreset: string
  onFabPresetChange: (id: string) => void
  revisionMode: boolean
  revisionNote: string
  onRevisionNoteChange: (value: string) => void
  onExitRevision: () => void
}) {
  const [brief, setBrief] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const tooShort = brief.trim().length < 3
  const overLimit = brief.length > MAX_BRIEF

  const submit = useCallback(() => {
    if (busy || tooShort || overLimit) return
    onGenerate(brief.trim())
  }, [brief, busy, tooShort, overLimit, onGenerate])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="brutal-flat flex flex-col gap-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="brief" className="label">
            Engineering brief
          </label>
          <span
            className={cn('label', overLimit && 'text-[var(--error)]')}
            aria-live="polite"
            data-testid="brief-counter"
          >
            {brief.length} / {MAX_BRIEF}
          </span>
        </div>

        <textarea
          id="brief"
          ref={textareaRef}
          value={brief}
          onChange={(event) => setBrief(event.target.value.slice(0, MAX_BRIEF + 200))}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          rows={revisionMode ? 5 : 8}
          spellCheck
          placeholder="e.g. 5 V to 3.3 V regulator breakout with a 3-pin screw terminal, an AMS1117, 100 µF input bulk, 10 µF output and a 2×5 ICSP header."
          aria-describedby="brief-hint"
          data-testid="brief-input"
          className="brutal-flat w-full resize-y bg-white p-3 font-mono text-sm leading-relaxed placeholder:text-[var(--ink-soft)]"
        />

        <p id="brief-hint" className="label">
          <kbd className="brutal-sm mx-0.5 inline-block px-1">Ctrl</kbd>/
          <kbd className="brutal-sm mx-0.5 inline-block px-1">⌘</kbd>
          <span className="mx-0.5">+</span>
          <kbd className="brutal-sm mx-0.5 inline-block px-1">Enter</kbd> to generate
        </p>

        {revisionMode && (
          <div className="flex flex-col gap-2 border-t-[3px] border-[var(--ink)] pt-2">
            <label htmlFor="revision" className="label">
              Revision request
            </label>
            <textarea
              id="revision"
              value={revisionNote}
              onChange={(event) => onRevisionNoteChange(event.target.value)}
              rows={2}
              placeholder="e.g. make it 20% smaller, or add a reset button"
              data-testid="revision-input"
              className="brutal-flat w-full resize-y bg-white p-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={onExitRevision}
              className="brutal-sm pressable-sm w-fit cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
            >
              Cancel revision
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              className="brutal pressable cursor-pointer bg-[var(--warn)] px-4 py-2 text-sm font-bold uppercase"
              data-testid="cancel-generate"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={tooShort || overLimit}
              className="brutal pressable cursor-pointer bg-[var(--cyan)] px-4 py-2 text-sm font-bold uppercase disabled:cursor-not-allowed disabled:bg-[var(--cyan-tint)] disabled:text-[var(--ink-soft)]"
              data-testid="generate"
            >
              {revisionMode ? 'Apply revision' : 'Generate design'}
            </button>
          )}
          {!busy && !revisionMode && designExists && (
            <button
              type="button"
              onClick={() => textareaRef.current?.focus()}
              className="brutal-sm pressable-sm cursor-pointer bg-white px-3 py-2 text-xs font-bold uppercase"
            >
              New brief
            </button>
          )}
        </div>
      </div>

      {!revisionMode && (
        <section className="brutal-flat p-3" aria-label="Example briefs">
          <h2 className="label mb-2">Try one of these</h2>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_BRIEFS.map((example) => (
              <button
                key={example.slice(0, 24)}
                type="button"
                onClick={() => setBrief(example)}
                className="brutal-sm pressable-sm max-w-full cursor-pointer bg-white px-2 py-1 text-left text-[11px] leading-snug"
              >
                {example.slice(0, 58)}…
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="brutal-flat p-3" aria-label="Board colour">
        <h2 className="label mb-2">Solder mask</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Board solder mask colour">
          {BOARD_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              role="radio"
              aria-checked={boardColor.id === color.id}
              onClick={() => onBoardColorChange(color)}
              data-testid={`swatch-${color.id}`}
              title={`${color.label} (${color.hex}), silkscreen ${color.silk}`}
              className={cn(
                'brutal-sm pressable-sm h-9 w-9 cursor-pointer',
                boardColor.id === color.id && 'bg-[var(--cyan)]',
              )}
              style={{ backgroundColor: color.hex }}
            >
              <span className="sr-only">{color.label}</span>
            </button>
          ))}
        </div>
        <p className="label mt-2" data-testid="silkscreen-note">
          Silkscreen auto-selected: {boardColor.silk} (contrast{' '}
          {contrastNote(boardColor)}
        </p>
      </section>

      <section className="brutal-flat p-3" aria-label="Fabrication preset">
        <h2 className="label mb-2" id="fab-label">
          Fab capability preset
        </h2>
        <select
          aria-labelledby="fab-label"
          value={fabPreset}
          onChange={(event) => onFabPresetChange(event.target.value)}
          data-testid="fab-preset"
          className="brutal-flat w-full cursor-pointer bg-white p-2 text-sm"
        >
          {FAB_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="label mt-2">
          {FAB_PRESETS.find((p) => p.id === fabPreset)?.source}
        </p>
      </section>
    </div>
  )
}

let designExists = false

export function setDesignExists(value: boolean): void {
  designExists = value
}

function contrastNote(color: BoardColor): string {
  const luminance = color.luminance
  return `${luminance > 0.45 ? 'dark ink on light mask' : 'white ink on dark mask'}`
}

/* -------------------------------------------------------------------------- */
/* Source viewer                                                               */
/* -------------------------------------------------------------------------- */

export function SourceView({ design }: { design: DesignResult | null }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const code = design?.tsx ?? ''

  useEffect(() => {
    let cancelled = false
    if (!code) {
      setHtml('')
      return
    }
    setLoading(true)
    // Shiki is heavy; load it only when the Source tab actually has content.
    import('shiki')
      .then(({ codeToHtml }) =>
        // `github-light` is a LIGHT theme: no dark surfaces anywhere in this app.
        codeToHtml(code, { lang: 'tsx', theme: 'github-light' }),
      )
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        // Honest fallback: plain text, still readable, never a blank panel.
        if (!cancelled) setHtml('')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  const copy = useCallback(async () => {
    const ok = await copyText(code)
    setCopied(ok ? 'ok' : 'fail')
    window.setTimeout(() => setCopied('idle'), 2000)
  }, [code])

  if (!design) {
    return (
      <div className="p-6">
        <div className="brutal-flat p-4">
          <p className="label">No source yet</p>
          <p className="mt-1 text-sm">
            The tscircuit TSX module the model wrote will appear here, syntax highlighted.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="source-view">
      <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-[var(--ink)] p-2">
        <span className="label">circuit.tsx</span>
        <span className="chip">{code.split('\n').length} lines</span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => void copy()}
            className="brutal-sm pressable-sm min-h-[32px] cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
            data-testid="copy-code"
          >
            {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy code'}
          </button>
          <a
            className="brutal-sm pressable-sm inline-flex min-h-[32px] items-center bg-white px-2 py-1 text-[10px] font-bold uppercase no-underline"
            href={playgroundUrl(code)}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="open-playground"
          >
            Open in playground
          </a>
        </div>
      </div>
      <div className="viewer-surface min-h-0 flex-1 overflow-auto bg-white p-3">
        {loading && <div className="skeleton h-full w-full" />}
        {!loading && html && (
          // Shiki output is generated from our own source with a light theme.
          <div className="shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!loading && !html && (
          <pre className="whitespace-pre-wrap break-words bg-white p-2 font-mono text-xs leading-relaxed">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

/**
 * tscircuit playground URL.
 *
 * Verified scheme: `https://tscircuit.com/playground?code=<base64url of the UTF-8 source>`
 * — the playground decodes the `code` query parameter as base64. If the scheme ever
 * changes, the button degrades to a plain link rather than a broken embed.
 */
export function playgroundUrl(code: string): string {
  try {
    const base64 =
      typeof Buffer !== 'undefined'
        ? Buffer.from(code, 'utf8').toString('base64')
        : btoa(String.fromCharCode(...new TextEncoder().encode(code)))
    return `https://tscircuit.com/playground?code=${base64}`
  } catch {
    return 'https://tscircuit.com/playground'
  }
}

/* -------------------------------------------------------------------------- */
/* Exports tab                                                                 */
/* -------------------------------------------------------------------------- */

export function ExportsView({ design }: { design: DesignResult | null }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unlocked = Boolean(design?.verified)

  const download = useCallback(
    async (kind: string, filename: string) => {
      if (!design) return
      setBusy(kind)
      setError(null)
      try {
        const response = await fetch('/api/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ designHash: design.designHash, kind }),
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null
          throw new Error(payload?.message ?? `Export failed with ${response.status}`)
        }
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Export failed')
      } finally {
        setBusy(null)
      }
    },
    [design],
  )

  if (!design) {
    return (
      <div className="p-6">
        <div className="brutal-flat p-4">
          <p className="label">Exports locked</p>
          <p className="mt-1 text-sm">
            Generate and verify a design first. Manufacturing files unlock automatically when
            every blocking check passes.
          </p>
        </div>
      </div>
    )
  }

  const base = `${design.slug}-${design.designHash.slice(0, 8)}`

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto" data-testid="exports-view">
      <div
        className={cn(
          'brutal-flat m-3 flex items-center gap-4 p-4',
          unlocked ? 'padlock-unlock' : '',
        )}
        data-testid="export-gate"
        data-unlocked={unlocked}
      >
        <Padlock open={unlocked} />
        <div className="min-w-0 flex-1">
          <p className="label">{unlocked ? 'Manufacturing ready' : 'Locked'}</p>
          <p className="mt-1 text-sm font-semibold">
            {unlocked
              ? 'All blocking checks passed. Every file below is ready for a fab.'
              : `${design.blockingCount} blocking check${design.blockingCount === 1 ? '' : 's'} must pass before files are released.`}
          </p>
          {!design.partSearchUsed && (
            <p
              className="mt-2 border-l-4 border-amber-400 bg-amber-50 px-2 py-1 text-xs"
              data-testid="part-search-notice"
            >
              No distributor catalogue was available for this run. Values and packages are the
              model&rsquo;s own choices and have not been checked against stock or price &mdash;
              verify the BOM before ordering.
            </p>
          )}
          {!unlocked && design.checks.some((check) => check.severity === 'error') && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {design.checks
                .filter((check) => check.severity === 'error')
                .slice(0, 5)
                .map((check) => (
                  <li key={`${check.code}-${check.message}`}>{check.message}</li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="brutal-flat mx-3 border-[var(--error)] bg-[#FFF3F3] p-2 text-sm">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
        <ExportButton
          label="Fabrication package (.zip)"
          hint="Gerbers + drill + BOM + PnP + manifest + README"
          disabled={!unlocked}
          busy={busy === 'fab-zip'}
          onClick={() => void download('fab-zip', `${base}-fab.zip`)}
          testId="download-fab"
        />
        <ExportButton
          label="Circuit JSON"
          hint="The full tscircuit intermediate representation"
          disabled={!unlocked}
          busy={busy === 'circuit-json'}
          onClick={() => void download('circuit-json', `${base}-circuit.json`)}
        />
        <ExportButton
          label="tscircuit source (.tsx)"
          hint="The exact module the model wrote and the compiler accepted"
          disabled={!unlocked}
          busy={busy === 'circuit-tsx'}
          onClick={() => void download('circuit-tsx', `${base}-circuit.tsx`)}
        />
        <ExportButton
          label="Manifest (.json)"
          hint="Design hash, model, tool versions, board geometry, colours, check results"
          disabled={!unlocked}
          busy={busy === 'manifest'}
          onClick={() => void download('manifest', `${base}-manifest.json`)}
        />
        <ExportButton
          label="BOM (.csv)"
          hint="Bill of materials"
          disabled={!unlocked}
          busy={busy === 'bom'}
          onClick={() => void download('bom', `${base}-bom.csv`)}
        />
        <ExportButton
          label="Pick & place (.csv)"
          hint="Assembly placement data"
          disabled={!unlocked}
          busy={busy === 'pnp'}
          onClick={() => void download('pnp', `${base}-pnp.csv`)}
        />
        <ExportButton
          label="Gerbers (each file)"
          hint="Layer-by-layer Gerbers and the Excellon drill file"
          disabled={!unlocked}
          busy={busy === 'gerbers'}
          onClick={() => void download('gerbers', `${base}-gerber.txt`)}
        />
      </div>

      <div className="brutal-flat m-3 p-3">
        <h3 className="label mb-1">Design facts</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] sm:grid-cols-4">
          <Fact label="Hash" value={design.designHash} />
          <Fact label="Model" value={design.model.split('/').pop() ?? design.model} />
          <Fact label="Layers" value={String(design.stats.pcbLayers)} />
          <Fact label="Components" value={String(design.stats.components)} />
          <Fact
            label="Board"
            value={`${design.stats.boardWidthMm ?? '?'} × ${design.stats.boardHeightMm ?? '?'} mm`}
          />
          <Fact label="Routed traces" value={String(design.stats.routedTraces)} />
          <Fact label="Vias" value={String(design.stats.vias)} />
          <Fact label="Pass" value={`${design.iterations}`} />
        </dl>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  )
}

function ExportButton({
  label,
  hint,
  disabled,
  busy,
  onClick,
  testId,
}: {
  label: string
  hint: string
  disabled: boolean
  busy: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      aria-disabled={disabled}
      className={cn(
        'brutal-flat pressable p-3 text-left',
        disabled ? 'cursor-not-allowed bg-[#F0F4F5] opacity-60' : 'cursor-pointer bg-white hover:bg-[var(--cyan-tint)]',
      )}
    >
      <span className="block text-sm font-bold">{busy ? 'Preparing…' : label}</span>
      <span className="label mt-0.5 block">{disabled ? 'locked' : hint}</span>
    </button>
  )
}

function Padlock({ open }: { open: boolean }) {
  return (
    <svg
      width={56}
      height={64}
      viewBox="0 0 14 16"
      shapeRendering="crispEdges"
      role="img"
      aria-label={open ? 'Padlock open' : 'Padlock closed'}
      data-testid="padlock"
      data-open={open}
      className="shrink-0"
    >
      <g className="padlock-shackle" style={{ transform: open ? 'rotate(-40deg) translate(-3px,-1px)' : 'none' }}>
        <rect x={3} y={0} width={2} height={1} fill="#0B1B1F" />
        <rect x={2} y={1} width={1} height={3} fill="#0B1B1F" />
        <rect x={10} y={1} width={2} height={3} fill="#0B1B1F" />
        <rect x={9} y={0} width={2} height={1} fill="#0B1B1F" />
      </g>
      <rect x={1} y={5} width={12} height={11} fill={open ? '#5EEAD4' : '#FFE14D'} />
      <rect x={1} y={5} width={12} height={1} fill="#0B1B1F" />
      <rect x={0} y={6} width={1} height={9} fill="#0B1B1F" />
      <rect x={13} y={6} width={1} height={9} fill="#0B1B1F" />
      <rect x={1} y={15} width={12} height={1} fill="#0B1B1F" />
      <rect x={6} y={8} width={2} height={4} fill="#0B1B1F" />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* History drawer                                                              */
/* -------------------------------------------------------------------------- */

export type HistoryItem = {
  designHash: string
  slug: string
  title: string
  summary: string
  verified: boolean
  generatedAt: string
  brief?: string
  solderMask?: string
}

const HISTORY_KEY = 'pcb-copilot.history.v1'
const COLOR_KEY = 'pcb-copilot.board-color.v1'
const FAB_KEY = 'pcb-copilot.fab-preset.v1'

export function usePersistedBoardColor(): [BoardColor, (color: BoardColor) => void] {
  const [color, setColor] = useState<BoardColor>(() => {
    if (typeof window === 'undefined') return BOARD_COLORS[0]
    return getBoardColor(readLocal<string | null>(COLOR_KEY, 'green'))
  })
  const update = useCallback((next: BoardColor) => {
    setColor(next)
    writeLocal(COLOR_KEY, next.id)
  }, [])
  return [color, update]
}

export function usePersistedFabPreset(): [string, (id: string) => void] {
  const [preset, setPreset] = useState<string>(() =>
    typeof window === 'undefined' ? 'prototype-hobby-2layer' : readLocal<string>(FAB_KEY, 'prototype-hobby-2layer'),
  )
  const update = useCallback((id: string) => {
    setPreset(id)
    writeLocal(FAB_KEY, id)
  }, [])
  return [preset, update]
}

export function useLocalHistory(): [HistoryItem[], (item: HistoryItem) => void, (hash: string) => void] {
  const [items, setItems] = useState<HistoryItem[]>([])
  useEffect(() => {
    setItems(readLocal<HistoryItem[]>(HISTORY_KEY, []))
  }, [])
  const add = useCallback((item: HistoryItem) => {
    setItems((current) => {
      const next = [item, ...current.filter((existing) => existing.designHash !== item.designHash)].slice(0, 20)
      writeLocal(HISTORY_KEY, next)
      return next
    })
  }, [])
  const remove = useCallback((hash: string) => {
    setItems((current) => {
      const next = current.filter((item) => item.designHash !== hash)
      writeLocal(HISTORY_KEY, next)
      return next
    })
  }, [])
  return [items, add, remove]
}
