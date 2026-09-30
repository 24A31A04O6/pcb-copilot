'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Zero } from '@/components/Zero'
import type { Check, CheckReport, DesignResult, PipelineStage } from '@/lib/design'
import { cn } from '@/lib/utils'
import type { ZeroState } from '@/components/zero-sprite'

/* -------------------------------------------------------------------------- */
/* SSE client                                                                  */
/* -------------------------------------------------------------------------- */

export type PipelineState = {
  stage: PipelineStage
  label: string
  log: Array<{ level: 'info' | 'warn'; message: string; at: number }>
  brief: { title: string; summary: string } | null
  report: CheckReport | null
  repairIterations: number[]
  design: DesignResult | null
  error: { code: string; message: string; retryable: boolean; details?: string[] } | null
  done: boolean
  startedAt: number
  durationMs: number
}

const EMPTY: PipelineState = {
  stage: 'queued',
  label: 'Idle',
  log: [],
  brief: null,
  report: null,
  repairIterations: [],
  design: null,
  error: null,
  done: false,
  startedAt: 0,
  durationMs: 0,
}

export type StartArgs = {
  brief: string
  revisionNote?: string
  boardColor: string
  fabPreset: string
}

export function usePipeline() {
  const [state, setState] = useState<PipelineState>(EMPTY)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const start = useCallback(async (args: StartArgs) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ ...EMPTY, startedAt: Date.now(), stage: 'brief', label: 'Starting…' })

    const apply = (fn: (previous: PipelineState) => PipelineState) =>
      setState((previous) => fn(previous))

    try {
      const response = await fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { code?: string; message?: string; retryable?: boolean }
          | null
        throw Object.assign(new Error(payload?.message ?? 'Could not start the pipeline.'), {
          code: payload?.code ?? 'INTERNAL',
          retryable: payload?.retryable ?? true,
        })
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            let payload: unknown
            try {
              payload = JSON.parse(raw)
            } catch {
              continue
            }
            if (typeof payload !== 'object' || payload === null) continue
            const { event, data } = payload as { event?: unknown; data?: unknown }
            if (typeof event !== 'string' || typeof data !== 'object' || data === null) continue
            const fields = data as Record<string, unknown>
            const detailText =
              typeof fields.detail === 'string' || typeof fields.detail === 'number'
                ? String(fields.detail)
                : undefined
            switch (event) {
              case 'stage':
                apply((p) => ({
                  ...p,
                  stage: fields.stage as PipelineStage,
                  label: String(fields.label),
                  ...(detailText ? { label: `${String(fields.label)} · ${detailText}` } : {}),
                }))
                break
              case 'log':
                apply((p) => ({
                  ...p,
                  log: [
                    ...p.log.slice(-199),
                    {
                      level: fields.level === 'warn' ? 'warn' : 'info',
                      message: String(fields.message),
                      at: Number(fields.at),
                    },
                  ],
                }))
                break
              case 'brief':
                apply((p) => ({
                  ...p,
                  brief: { title: String(fields.title), summary: String(fields.summary) },
                }))
                break
              case 'compile':
              case 'checks':
                if (event === 'checks') {
                  apply((p) => ({ ...p, report: fields.report as CheckReport }))
                }
                break
              case 'done':
                apply((p) => ({
                  ...p,
                  design: fields.design as DesignResult,
                  done: true,
                  stage: 'done',
                  label: (fields.design as DesignResult).verified ? 'Verified' : 'Blocking checks remain',
                  durationMs: Date.now() - p.startedAt,
                }))
                break
              case 'error':
                apply((p) => ({
                  ...p,
                  error: {
                    code: String(fields.code),
                    message: String(fields.message),
                    retryable: Boolean(fields.retryable),
                    ...(Array.isArray(fields.details) ? { details: fields.details as string[] } : {}),
                  },
                  done: true,
                  stage: 'error',
                  label: String(fields.message),
                  durationMs: Date.now() - p.startedAt,
                }))
                break
              default:
                if (event.startsWith('repair#')) {
                  const iteration = Number(event.slice('repair#'.length))
                  apply((p) => ({ ...p, repairIterations: [...p.repairIterations, iteration] }))
                }
                break
            }
          }
        }
        if (done) break
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState((previous) => ({ ...previous, done: true, stage: 'error', label: 'Cancelled' }))
        return
      }
      const typed = error as Error & { code?: string; retryable?: boolean; details?: string[] }
      setState((previous) => ({
        ...previous,
        done: true,
        stage: 'error',
        label: typed.message || 'The pipeline failed.',
        error: {
          code: typed.code ?? 'INTERNAL',
          message: typed.message || 'The pipeline failed.',
          retryable: typed.retryable ?? true,
          ...(typed.details ? { details: typed.details } : {}),
        },
        durationMs: Date.now() - previous.startedAt,
      }))
    } finally {
      abortRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => setState(EMPTY), [])

  return { state, start, cancel, reset }
}

export function zeroStateFor(pipeline: PipelineState): ZeroState {
  if (pipeline.error) return 'error'
  if (pipeline.design?.verified) return 'success'
  if (pipeline.design && !pipeline.design.verified) return 'repairing'
  switch (pipeline.stage) {
    case 'brief':
      return 'reading'
    case 'codegen':
      return 'compiling'
    case 'compile':
      return 'compiling'
    case 'checks':
      return 'checking'
    case 'repair':
      return 'repairing'
    case 'done':
      return pipeline.design?.verified ? 'success' : 'repairing'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

/* -------------------------------------------------------------------------- */
/* Pipeline stepper                                                            */
/* -------------------------------------------------------------------------- */

const STEPS = [
  { key: 'brief', label: 'Brief' },
  { key: 'codegen', label: 'Code' },
  { key: 'compile', label: 'Compile' },
  { key: 'checks', label: 'Checks' },
  { key: 'repair', label: 'Repair' },
  { key: 'verified', label: 'Verified' },
] as const

type StepKey = (typeof STEPS)[number]['key']

function stepStatus(pipeline: PipelineState, step: StepKey): 'todo' | 'active' | 'done' | 'fail' {
  const order: StepKey[] = ['brief', 'codegen', 'compile', 'checks', 'repair', 'verified']
  const current: number = (() => {
    switch (pipeline.stage) {
      case 'queued':
        return -1
      case 'brief':
        return 0
      case 'codegen':
        return 1
      case 'compile':
        return 2
      case 'checks':
        return 3
      case 'repair':
        return pipeline.repairIterations.length > 0 ? 3 : 4
      case 'done':
        return pipeline.design?.verified ? 5 : 4
      case 'error':
        return -1
    }
  })()
  const index = order.indexOf(step)

  if (pipeline.error && index <= current) return index === current ? 'fail' : 'done'
  if (index < current) return 'done'
  if (index === current) {
    if (step === 'repair' && pipeline.repairIterations.length === 0 && current === 4) return 'active'
    return 'active'
  }
  if (step === 'repair' && pipeline.repairIterations.length > 0 && index === 3) return 'done'
  return 'todo'
}

export function Stepper({ pipeline }: { pipeline: PipelineState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (pipeline.done) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [pipeline.done])

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Pipeline progress">
      {STEPS.map((step) => {
        const status = stepStatus(pipeline, step.key)
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center border-2 border-[var(--ink)] text-[10px] font-black',
                status === 'done' && 'bg-[var(--success)]',
                status === 'active' && 'bg-[var(--cyan)]',
                status === 'fail' && 'bg-[var(--error)]',
                status === 'todo' && 'bg-white',
              )}
            >
              {status === 'done' ? '✓' : status === 'fail' ? '!' : status === 'active' ? '•' : ''}
            </span>
            <span
              className={cn(
                'label',
                status === 'active' && 'text-[var(--ink)]',
                status === 'todo' && 'opacity-50',
              )}
            >
              {step.label}
              {status === 'active' && <span className="sr-only"> (in progress)</span>}
            </span>
            {status === 'active' && (
              <span
                aria-hidden
                className="ml-auto h-1.5 w-16 overflow-hidden rounded-full border border-[var(--ink)] bg-white"
              >
                <span className="fill-bar block h-full w-full origin-left bg-[var(--cyan)]" />
              </span>
            )}
          </li>
        )
      })}
      <li className="sr-only" aria-live="polite" aria-atomic="true">
        {pipeline.done
          ? pipeline.error
            ? `Pipeline failed: ${pipeline.error.message}`
            : pipeline.design?.verified
              ? `Design verified after ${pipeline.design.iterations} pass${pipeline.design.iterations === 1 ? '' : 'es'}.`
              : 'Design generated with blocking checks remaining.'
          : `${pipeline.label}. Stage ${pipeline.stage}.`}
      </li>
      {!pipeline.done && pipeline.startedAt > 0 && (
        <li className="label mt-1">{((now - pipeline.startedAt) / 1000).toFixed(0)}s elapsed</li>
      )}
      {pipeline.done && pipeline.durationMs > 0 && (
        <li className="label mt-1">{(pipeline.durationMs / 1000).toFixed(1)}s total</li>
      )}
    </ol>
  )
}

/* -------------------------------------------------------------------------- */
/* Mascot + stepper combo                                                      */
/* -------------------------------------------------------------------------- */

export function PipelinePanel({ pipeline }: { pipeline: PipelineState }) {
  const zero = zeroStateFor(pipeline)
  return (
    <section className="brutal-flat p-3" aria-label="Pipeline">
      <header className="mb-2 flex items-center gap-3">
        <Zero state={zero} size={64} />
        <div className="min-w-0">
          <h2 className="label">ZERO</h2>
          <p className="truncate text-sm font-bold">{pipeline.label}</p>
        </div>
      </header>
      <Stepper pipeline={pipeline} />
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Activity log                                                                */
/* -------------------------------------------------------------------------- */

export function ActivityLog({ pipeline }: { pipeline: PipelineState }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [pipeline.log.length])

  return (
    <section className="brutal-flat flex min-h-0 flex-1 flex-col" aria-label="Activity log">
      <h2 className="label border-b-[3px] border-[var(--ink)] px-3 py-2">Activity</h2>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
        {pipeline.log.length === 0 ? (
          <p className="p-2 text-[var(--ink-soft)]">
            Stages, model calls and check results will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pipeline.log.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className={cn(
                  'check-reveal flex gap-2',
                  entry.level === 'warn' && 'text-[var(--ink)]',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-[3px] inline-block h-2 w-2 shrink-0 border border-[var(--ink)]',
                    entry.level === 'warn' ? 'bg-[var(--warn)]' : 'bg-[var(--cyan)]',
                  )}
                />
                <span className="break-words">
                  {entry.message.length > 220 ? `${entry.message.slice(0, 220)}…` : entry.message}
                </span>
              </li>
            ))}
            <div ref={endRef} />
          </ul>
        )}
      </div>
    </section>
  )
}

export function ErrorPanel({
  error,
  onRetry,
}: {
  error: NonNullable<PipelineState['error']>
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="brutal-flat border-[var(--error)] bg-[#FFF3F3] p-3"
      data-testid="error-panel"
    >
      <div className="flex items-start gap-3">
        <Zero state="error" size={48} />
        <div className="min-w-0 flex-1">
          <p className="label text-[var(--ink)]">{error.code}</p>
          <p className="mt-1 text-sm font-medium">{error.message}</p>
          {error.details && error.details.length > 0 && (
            <ul className="mt-2 list-disc pl-4 font-mono text-[11px] text-[var(--ink-soft)]">
              {error.details.slice(0, 5).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          {error.retryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="brutal-sm pressable-sm mt-3 cursor-pointer bg-[var(--cyan)] px-3 py-1.5 text-xs font-bold uppercase"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChecksSummary({ report }: { report: CheckReport | null }) {
  if (!report) return null
  return (
    <div className="flex flex-wrap gap-2">
      <span className={cn('chip', report.blockingCount > 0 ? 'chip-bad' : 'chip-ok')}>
        {report.blockingCount} blocking
      </span>
      <span className={cn('chip', report.warningCount > 0 ? 'chip-warn' : '')}>
        {report.warningCount} warnings
      </span>
      <span className="chip">{report.fabPresetLabel}</span>
    </div>
  )
}

export function CheckList({
  checks,
  onSelect,
}: {
  checks: Check[]
  onSelect?: (check: Check) => void
}) {
  const groups = [
    { severity: 'error' as const, title: 'Blocking', tone: 'chip-bad' },
    { severity: 'warning' as const, title: 'Warnings', tone: 'chip-warn' },
  ]
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const items = checks.filter((check) => check.severity === group.severity)
        return (
          <section key={group.severity}>
            <h3 className="label mb-1 flex items-center gap-2">
              <span className={cn('chip', group.tone)}>{items.length}</span>
              {group.title}
            </h3>
            {items.length === 0 ? (
              <p className="px-1 text-xs text-[var(--ink-soft)]">None.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {items.map((check, index) => (
                  <li key={`${check.code}-${index}`} className="check-reveal">
                    <button
                      type="button"
                      onClick={() => onSelect?.(check)}
                      disabled={!onSelect}
                      className={cn(
                        'brutal-flat w-full p-2 text-left',
                        onSelect && 'pressable-sm cursor-pointer hover:bg-[var(--cyan-tint)]',
                      )}
                      style={{ animationDelay: `${Math.min(index * 24, 400)}ms` }}
                      data-testid={`check-${check.code}`}
                    >
                      <span className="label block">{check.code}</span>
                      <span className="block text-xs leading-snug">{check.message}</span>
                      {check.components && check.components.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {check.components.slice(0, 6).map((name) => (
                            <span key={name} className="chip">
                              {name}
                            </span>
                          ))}
                        </span>
                      )}
                      {check.rule && <span className="label mt-1 block">rule · {check.rule}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
