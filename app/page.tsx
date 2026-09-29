'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Zero } from '@/components/Zero'
import {
  ActivityLog,
  CheckList,
  ErrorPanel,
  PipelinePanel,
  usePipeline,
  zeroStateFor,
} from '@/components/Pipeline'
import {
  BriefComposer,
  ExportsView,
  SourceView,
  useLocalHistory,
  usePersistedBoardColor,
  usePersistedFabPreset,
  type HistoryItem,
} from '@/components/Workspace'
import { applySolderMask, getBoardColor, BOARD_COLORS } from '@/lib/board-colors'
import { CommandPalette, useCommandShortcuts, type Command } from '@/components/CommandPalette'
import { copyText } from '@/lib/utils'
import type { Check, DesignResult } from '@/lib/design'
import { cn } from '@/lib/utils'

const PcbView = dynamic(
  () => import('@/components/Viewers').then((mod) => mod.PcbView),
  { ssr: false, loading: () => <ViewerLoading /> },
)
const SchematicView = dynamic(
  () => import('@/components/Viewers').then((mod) => mod.SchematicView),
  { ssr: false, loading: () => <ViewerLoading /> },
)
const ViewPanel = dynamic(
  () => import('@/components/Viewers').then((mod) => mod.Panel),
  { ssr: false },
)
const ThreeDView = dynamic(
  () => import('@/components/Viewers').then((mod) => mod.ThreeDView),
  { ssr: false, loading: () => <ViewerLoading label="Loading 3D…" /> },
)

function ViewerLoading({ label = 'Loading viewer…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col gap-2 p-4" aria-busy="true">
      <span className="label">{label}</span>
      <div className="skeleton h-4 w-2/3" />
      <div className="skeleton h-32 w-full" />
      <div className="skeleton h-20 w-4/5" />
    </div>
  )
}

const TABS = [
  { id: 'schematic', label: 'Schematic' },
  { id: 'pcb', label: 'PCB' },
  { id: '3d', label: '3D' },
  { id: 'checks', label: 'Source + Checks' },
  { id: 'exports', label: 'Exports' },
] as const

type TabId = (typeof TABS)[number]['id']

/** One command per board colour, so the palette and the swatch row stay in step. */
function BOARD_COLOR_COMMANDS(activeId: string, onPick: (id: string) => void): Command[] {
  return BOARD_COLORS.map((color) => ({
    id: `colour-${color.id}`,
    label: `Board colour: ${color.label}`,
    group: 'Board colour',
    hint: color.id === activeId ? 'current' : undefined,
    run: () => onPick(color.id),
  }))
}

/**
 * The tscircuit playground runs code in the URL fragment, base64 encoded. `btoa` fails on
 * anything outside Latin-1, and tscircuit source routinely contains `µ`, so the text goes
 * through a UTF-8 encoder first.
 */
function playgroundUrl(tsx: string): string {
  const bytes = new TextEncoder().encode(tsx)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `https://tscircuit.com/playground?code=${btoa(binary)}`
}

export default function Page() {
  const { state, start, cancel } = usePipeline()
  const [tab, setTab] = useState<TabId>('schematic')
  const [boardColor, setBoardColor] = usePersistedBoardColor()
  const [fabPreset, setFabPreset] = usePersistedFabPreset()
  const [history, addHistory] = useLocalHistory()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedCheck, setSelectedCheck] = useState<Check | null>(null)
  const [revisionMode, setRevisionMode] = useState(false)
  const [revisionNote, setRevisionNote] = useState('')
  const [offline, setOffline] = useState(false)
  const [lastBrief, setLastBrief] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const design = state.design

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // The colour is a property of Circuit JSON, so a swatch click is a data change, not a
  // re-render of the whole tree. (docs/DECISIONS.md §4)
  const tintedCircuitJson = useMemo(() => {
    if (!design?.circuitJson?.length) return []
    const clone = design.circuitJson.map((element) =>
      typeof element === 'object' && element !== null ? { ...(element) } : element,
    )
    applySolderMask(clone, boardColor.hex)
    return clone
  }, [design, boardColor.hex])

  // One history entry per design hash. The ref is the guard rather than a narrow dependency
  // array, so a later colour change updates the entry instead of silently re-running nothing.
  const recordedHash = useRef<string | null>(null)
  useEffect(() => {
    if (!design || recordedHash.current === design.designHash) return
    recordedHash.current = design.designHash
    addHistory({
      designHash: design.designHash,
      slug: design.slug,
      title: design.title,
      summary: design.summary,
      verified: design.verified,
      generatedAt: design.generatedAt,
      brief: lastBrief,
      solderMask: boardColor.mask,
    })
  }, [design, addHistory, lastBrief, boardColor.mask])

  const generate = useCallback(
    (brief: string) => {
      setLastBrief(brief)
      setSelectedCheck(null)
      void start({
        brief,
        ...(revisionMode && revisionNote.trim() ? { revisionNote: revisionNote.trim() } : {}),
        boardColor: boardColor.id,
        fabPreset,
      })
    },
    [start, revisionMode, revisionNote, boardColor.id, fabPreset],
  )

  const busy = !state.done && state.startedAt > 0
  const zero = zeroStateFor(state)

  const tabIndex = TABS.findIndex((entry) => entry.id === tab)

  // Every action the header and the panels offer, in one list, so the palette can never
  // drift out of step with the UI: it is built from the same TABS and the same handlers.
  const commands = useMemo<Command[]>(
    () => [
      ...TABS.map((entry) => ({
        id: `go-${entry.id}`,
        label: `Go to ${entry.label}`,
        group: 'Views',
        run: () => setTab(entry.id),
      })),
      {
        id: 'generate',
        label: lastBrief ? 'Regenerate this design' : 'Generate a design',
        group: 'Design',
        hint: 'G',
        disabled: busy || lastBrief.length === 0,
        run: () => void generate(lastBrief),
      },
      {
        id: 'revise',
        label: 'Revise the current design',
        group: 'Design',
        disabled: !design?.verified || busy,
        run: () => setRevisionMode(true),
      },
      {
        id: 'history',
        label: 'Open design history',
        group: 'Design',
        hint: 'H',
        run: () => setHistoryOpen(true),
      },
      {
        id: 'new',
        label: 'Start over with a fresh brief',
        group: 'Design',
        run: () => {
          setRevisionMode(false)
          setRevisionNote('')
          setTab('schematic')
        },
      },
      ...BOARD_COLOR_COMMANDS(boardColor.id, (id) => setBoardColor({ ...boardColor, id })),
      {
        id: 'copy-source',
        label: 'Copy the tscircuit source',
        group: 'Export',
        disabled: !design,
        run: () => void copyText(design?.tsx ?? ''),
      },
      {
        id: 'playground',
        label: 'Open the design in the tscircuit playground',
        group: 'Export',
        disabled: !design,
        run: () => {
          if (!design) return
          window.open(playgroundUrl(design.tsx), '_blank', 'noopener,noreferrer')
        },
      },
    ],
    [busy, boardColor, design, generate, lastBrief, setBoardColor],
  )

  useCommandShortcuts(
    () => setPaletteOpen((open) => !open),
    () => setPaletteOpen(true),
  )

  // Single-key shortcuts. They are ignored while the palette is open, so typing "g" into
  // the palette filter does not also regenerate a design, and while a field has focus, so
  // "g" in a brief stays a letter.
  useEffect(() => {
    if (paletteOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= TABS.length) {
        event.preventDefault()
        setTab(TABS[digit - 1].id)
        return
      }
      if (event.key === 'g' || event.key === 'G') {
        if (!busy && lastBrief) {
          event.preventDefault()
          void generate(lastBrief)
        }
        return
      }
      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        setHistoryOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, generate, lastBrief, paletteOpen])

  return (
    <div className="flex h-svh min-h-0 flex-col bg-[var(--paper)]">
      <Header
        design={design}
        busy={busy}
        model={design?.model}
        onHistory={() => setHistoryOpen(true)}
        historyCount={history.length}
        offline={offline}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* ---------------- left column ---------------- */}
        <aside
          className="flex min-h-0 w-full shrink-0 flex-col border-b-[3px] border-[var(--ink)] bg-[var(--paper)] md:w-[380px] md:border-b-0 md:border-r-[3px]"
          aria-label="Brief and pipeline"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <BriefComposer
              onGenerate={generate}
              busy={busy}
              onCancel={cancel}
              boardColor={boardColor}
              onBoardColorChange={(color) => setBoardColor(color)}
              fabPreset={fabPreset}
              onFabPresetChange={setFabPreset}
              revisionMode={revisionMode}
              revisionNote={revisionNote}
              onRevisionNoteChange={setRevisionNote}
              onExitRevision={() => {
                setRevisionMode(false)
                setRevisionNote('')
              }}
            />
          </div>

          <div className="flex min-h-0 flex-col gap-3 border-t-[3px] border-[var(--ink)] p-3">
            {state.error && <ErrorPanel error={state.error} onRetry={() => generate(lastBrief)} />}
            {design?.verified && (
              <button
                type="button"
                onClick={() => setRevisionMode(true)}
                disabled={busy}
                className="brutal pressable w-full cursor-pointer bg-[var(--warn)] px-3 py-2 text-sm font-bold uppercase disabled:opacity-60"
                data-testid="start-revision"
              >
                Revise this design
              </button>
            )}
            <PipelinePanel pipeline={state} />
            <div className="flex max-h-[220px] min-h-[120px] flex-col">
              <ActivityLog pipeline={state} />
            </div>
          </div>
        </aside>

        {/* ---------------- right column ---------------- */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Design output">
          <div
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b-[3px] border-[var(--ink)] bg-white p-1"
            role="tablist"
            aria-label="Design views"
            data-testid="tabs"
          >
            {TABS.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`tab-${entry.id}`}
                aria-selected={tab === entry.id}
                aria-controls={`panel-${entry.id}`}
                tabIndex={tab === entry.id ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    const delta = event.key === 'ArrowRight' ? 1 : -1
                    const next = (index + delta + TABS.length) % TABS.length
                    setTab(TABS[next].id)
                    document.getElementById(`tab-${TABS[next].id}`)?.focus()
                  }
                }}
                className={cn(
                  'min-h-[40px] shrink-0 cursor-pointer border-[3px] border-[var(--ink)] px-3 py-1.5 text-xs font-bold uppercase transition-transform',
                  tab === entry.id
                    ? 'bg-[var(--cyan)] shadow-[3px_3px_0_0_var(--ink)] -translate-x-[1px] -translate-y-[1px]'
                    : 'bg-white hover:bg-[var(--cyan-tint)]',
                )}
                data-testid={`tab-${entry.id}`}
              >
                {entry.label}
                {entry.id === 'exports' && design?.verified && (
                  <span className="ml-1.5 inline-block h-2 w-2 bg-[var(--success)] align-middle" />
                )}
                {entry.id === 'checks' && design && design.blockingCount > 0 && (
                  <span className="ml-1.5 inline-block h-2 w-2 bg-[var(--error)] align-middle" />
                )}
              </button>
            ))}
          </div>

          <div
            className="min-h-0 flex-1 overflow-hidden"
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === 'schematic' && (
              <ViewPanel title="Schematic" className="tab-panel-in h-full">
                {design ? (
                  <SchematicView circuitJson={tintedCircuitJson} />
                ) : (
                  <EmptyState zero={zero} busy={busy} stageLabel={state.label} />
                )}
              </ViewPanel>
            )}

            {tab === 'pcb' && (
              <ViewPanel title="PCB" className="tab-panel-in h-full">
                {design ? (
                  <PcbView circuitJson={tintedCircuitJson} highlight={selectedCheck} />
                ) : (
                  <EmptyState zero={zero} busy={busy} stageLabel={state.label} />
                )}
              </ViewPanel>
            )}

            {tab === '3d' && (
              <ViewPanel title="3D" className="tab-panel-in h-full">
                {design && tintedCircuitJson.length > 0 ? (
                  <ThreeDView circuitJson={tintedCircuitJson} maskHex={boardColor.hex} />
                ) : (
                  <EmptyState zero={zero} busy={busy} stageLabel={state.label} />
                )}
              </ViewPanel>
            )}

            {tab === 'checks' && (
              <div className="grid h-full min-h-0 grid-rows-[auto_1fr] tab-panel-in lg:grid-cols-[1fr_360px] lg:grid-rows-1">
                <ViewPanel title="Source" className="min-h-[280px] border-b-[3px] border-[var(--ink)] lg:border-b-0 lg:border-r-[3px]">
                  <SourceView design={design} />
                </ViewPanel>
                <div className="min-h-0 overflow-auto p-3">
                  <h2 className="label mb-2">Checks</h2>
                  {design ? (
                    <CheckList checks={design.checks} onSelect={setSelectedCheck} />
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">
                      Checks appear here as soon as the first compile finishes.
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'exports' && (
              <ViewPanel title="Exports" className="tab-panel-in h-full">
                <ExportsView design={design} />
              </ViewPanel>
            )}
          </div>
        </main>
      </div>

      <CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />

      {historyOpen && (
        <HistoryDrawer
          items={history}
          onClose={() => setHistoryOpen(false)}
          onRestore={(item) => {
            if (item.brief) generate(item.brief)
            setHistoryOpen(false)
          }}
        />
      )}

      {/* Mobile tab bar: 44px minimum touch targets. */}
      <nav
        className="flex shrink-0 border-t-[3px] border-[var(--ink)] bg-white md:hidden"
        aria-label="Views"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? 'page' : undefined}
            className={cn(
              'min-h-[44px] flex-1 cursor-pointer border-r-[2px] border-[var(--ink)] px-1 py-2 text-[10px] font-bold uppercase last:border-r-0',
              tab === entry.id ? 'bg-[var(--cyan)]' : 'bg-white',
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <span className="sr-only" aria-live="polite">
        {tabIndex >= 0 ? `${TABS[tabIndex].label} view selected` : ''}
      </span>
    </div>
  )
}

function EmptyState({
  zero,
  busy,
  stageLabel,
}: {
  zero: ReturnType<typeof zeroStateFor>
  busy: boolean
  stageLabel: string
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="stagger brutal-flat max-w-md p-5 text-center">
        <Zero state={zero} size={128} className="mx-auto" />
        <h2 className="mt-3 text-lg font-bold">
          {busy ? stageLabel : 'Describe the board you need'}
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          {busy
            ? 'ZERO is working: brief, tscircuit source, compile, checks, repair, then verified.'
            : 'Fireworks writes real tscircuit source, compiles it in an isolated sandbox, runs connectivity, placement and fab checks, repairs failures, and unlocks manufacturing files only after verification.'}
        </p>
        {!busy && (
          <ul className="mt-4 flex flex-col gap-1 text-left">
            {[
              'Schematic, routed PCB and 3D board',
              'Grouped checks you can click to locate',
              'Gerbers, drill, BOM and pick-and-place',
            ].map((line) => (
              <li key={line} className="flex items-center gap-2 text-xs">
                <span className="inline-block h-2.5 w-2.5 border-2 border-[var(--ink)] bg-[var(--cyan)]" />
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Header({
  design,
  busy,
  model,
  onHistory,
  historyCount,
  offline,
}: {
  design: DesignResult | null
  busy: boolean
  model?: string
  onHistory: () => void
  historyCount: number
  offline: boolean
}) {
  const status = offline
    ? { label: 'Offline', tone: 'chip-warn' as const }
    : busy
      ? { label: 'Working', tone: 'chip-solid' as const }
      : design?.verified
        ? { label: 'Verified', tone: 'chip-ok' as const }
        : design
          ? { label: `${design.blockingCount} blocking`, tone: 'chip-bad' as const }
          : { label: 'Ready', tone: '' as const }

  return (
    <header className="flex min-h-[56px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-[3px] border-[var(--ink)] bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <Zero state={busy ? 'compiling' : design?.verified ? 'success' : 'idle'} size={40} />
        <div className="flex flex-col leading-none">
          <span className="pixel text-sm font-bold">PCB-COPILOT</span>
          <span className="label">by ZERO</span>
        </div>
      </div>

      {model && <span className="chip">{model.split('/').pop()}</span>}

      <div className="ml-auto flex items-center gap-2">
        <span className={cn('chip', status.tone)} data-testid="status-pill">
          {busy && <span aria-hidden className="live-dot inline-block h-2 w-2 bg-[var(--ink)]" />}
          {status.label}
        </span>
        <button
          type="button"
          onClick={onHistory}
          className="brutal-sm pressable-sm min-h-[36px] cursor-pointer bg-white px-2.5 py-1 text-[10px] font-bold uppercase"
          data-testid="open-history"
        >
          History{historyCount ? ` (${historyCount})` : ''}
        </button>
      </div>
    </header>
  )
}

function HistoryDrawer({
  items,
  onClose,
  onRestore,
}: {
  items: HistoryItem[]
  onClose: () => void
  onRestore: (item: HistoryItem) => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(11,27,31,0.28)]"
      role="dialog"
      aria-modal="true"
      aria-label="Design history"
    >
      <div className="flex h-full w-full max-w-sm flex-col border-l-[3px] border-[var(--ink)] bg-[var(--paper)]">
        <header className="flex items-center gap-2 border-b-[3px] border-[var(--ink)] bg-white p-3">
          <h2 className="text-sm font-bold uppercase">History</h2>
          <button
            type="button"
            onClick={onClose}
            className="brutal-sm pressable-sm ml-auto min-h-[36px] cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {items.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">
              Designs you generate are remembered in this browser.
            </p>
          ) : (
            <ul className="stagger flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.designHash}>
                  <button
                    type="button"
                    onClick={() => onRestore(item)}
                    className="brutal-flat pressable w-full cursor-pointer bg-white p-2 text-left hover:bg-[var(--cyan-tint)]"
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('chip', item.verified ? 'chip-ok' : 'chip-bad')}>
                        {item.verified ? 'verified' : 'blocked'}
                      </span>
                      <span className="label ml-auto">{item.generatedAt.slice(0, 10)}</span>
                    </span>
                    <span className="mt-1 block text-sm font-semibold">{item.title}</span>
                    <span className="label mt-0.5 block line-clamp-2">{item.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export { getBoardColor, BOARD_COLORS }
