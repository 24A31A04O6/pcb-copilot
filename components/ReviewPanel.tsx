'use client'

import { useState } from 'react'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  XCircleIcon,
  LightbulbIcon,
  ShieldCheckIcon,
  CpuIcon,
  ZapIcon,
  LayersIcon,
  FileWarningIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BrutalCard, BrutalCardHeader, BrutalCardTitle } from '@/components/ui/brutal-card'
import type { DesignDiagnostic, DesignResult } from '@/lib/design'
import { categorizeDiagnostics, getManufacturingReadinessScore } from '@/lib/design'

type ReviewPanelProps = {
  design: DesignResult | null
  onRunReview?: () => void
  isReviewing?: boolean
}

type ChecklistItem = {
  id: string
  label: string
  passed: boolean
  severity: 'critical' | 'high' | 'medium' | 'low'
  message: string
  details?: DesignDiagnostic[]
}

export function ReviewPanel({ design, onRunReview, isReviewing }: ReviewPanelProps) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all')
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())

  if (!design) {
    return (
      <BrutalCard variant="white" shadow="default" className="p-6">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="border-[3px] border-black bg-zinc-100 p-4">
            <ShieldCheckIcon className="size-8" />
          </div>
          <h3 className="font-black uppercase tracking-widest">No design to review</h3>
          <p className="max-w-sm font-mono text-xs leading-relaxed text-muted-foreground">
            Generate a PCB first. The review panel will analyze ERC, DRC, connectivity, and
            manufacturing readiness with actionable suggestions.
          </p>
        </div>
      </BrutalCard>
    )
  }

  const categorized = categorizeDiagnostics(design.diagnostics)
  const score = getManufacturingReadinessScore(design)
  const filteredDiagnostics =
    filter === 'all'
      ? design.diagnostics
      : design.diagnostics.filter((d) => d.severity === filter)

  const checklist: ChecklistItem[] = [
    {
      id: 'compile',
      label: 'COMPILATION',
      passed: true,
      severity: 'critical',
      message: 'TSX compiles to Circuit JSON',
    },
    {
      id: 'errors',
      label: 'BLOCKING ERRORS',
      passed: categorized.errors.length === 0,
      severity: 'critical',
      message:
        categorized.errors.length === 0
          ? 'No blocking errors — ready for fab'
          : `${categorized.errors.length} blocking error(s) must be fixed`,
      details: categorized.errors.slice(0, 3),
    },
    {
      id: 'warnings',
      label: 'WARNINGS',
      passed: categorized.warnings.length <= 3,
      severity: 'medium',
      message:
        categorized.warnings.length === 0
          ? 'Clean — no warnings'
          : `${categorized.warnings.length} warning(s) — review recommended`,
      details: categorized.warnings.slice(0, 3),
    },
    {
      id: 'components',
      label: 'COMPONENTS',
      passed: design.stats.components > 0,
      severity: 'critical',
      message: `${design.stats.components} components placed`,
    },
    {
      id: 'nets',
      label: 'NETS',
      passed: design.stats.sourceTraces > 0,
      severity: 'high',
      message: `${design.stats.sourceTraces} nets, ${design.stats.routedTraces} routed (${Math.round((design.stats.routedTraces / Math.max(1, design.stats.sourceTraces)) * 100)}%)`,
    },
    {
      id: 'layers',
      label: 'LAYERS',
      passed: design.stats.pcbLayers >= 1,
      severity: 'low',
      message: `${design.stats.pcbLayers} layer(s)`,
    },
    {
      id: 'board',
      label: 'BOARD SIZE',
      passed: !!design.stats.boardWidthMm,
      severity: 'medium',
      message: design.stats.boardWidthMm
        ? `${design.stats.boardWidthMm} × ${design.stats.boardHeightMm} mm`
        : 'Board dimensions not detected',
    },
    {
      id: 'verified',
      label: 'MANUFACTURING GATE',
      passed: design.verified,
      severity: 'critical',
      message: design.verified ? 'PASSED — exports unlocked' : 'BLOCKED — fix errors',
    },
  ]

  const groupedByType = filteredDiagnostics.reduce(
    (acc, diag) => {
      if (!acc[diag.type]) acc[diag.type] = []
      acc[diag.type].push(diag)
      return acc
    },
    {} as Record<string, DesignDiagnostic[]>,
  )

  return (
    <div className="space-y-4 p-4">
      {/* Score Card */}
      <BrutalCard
        variant={design.verified ? 'cyan' : 'white'}
        shadow="lg"
        className="relative overflow-hidden"
      >
        <div className="absolute right-0 top-0 border-b-[3px] border-l-[3px] border-black bg-black px-3 py-1">
          <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">
            REVIEW v2.0
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {design.verified ? (
                <CheckCircle2Icon className="size-5" />
              ) : (
                <XCircleIcon className="size-5" />
              )}
              <h2 className="font-black text-lg uppercase tracking-wider">
                {design.verified ? 'MANUFACTURING READY' : 'NEEDS WORK'}
              </h2>
            </div>
            <p className="mt-1 max-w-xl font-mono text-xs leading-relaxed">{design.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={score >= 80 ? 'success' : score >= 50 ? 'warning' : 'destructive'}>
                SCORE {score}%
              </Badge>
              <Badge variant="outline">{design.iterations} PASS(ES)</Badge>
              <Badge variant="outline">{design.model.split('/').pop()}</Badge>
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="border-[3px] border-black bg-white p-2 shadow-[4px_4px_0px_0px_black]">
              <div className="font-mono text-[10px] uppercase">Readiness</div>
              <div className="font-black text-3xl">{score}%</div>
              <div className="h-2 w-20 border-[2px] border-black bg-zinc-100">
                <div
                  className="h-full bg-[#00E5FF] transition-all"
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'COMPONENTS', value: design.stats.components, icon: CpuIcon },
            { label: 'NETS', value: design.stats.sourceTraces, icon: ZapIcon },
            { label: 'ROUTED', value: design.stats.routedTraces, icon: LayersIcon },
            { label: 'ERRORS', value: categorized.errors.length, icon: FileWarningIcon },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="border-[2.5px] border-black bg-white p-2.5 shadow-[2px_2px_0px_0px_black]">
              <div className="flex items-center gap-1.5">
                <Icon className="size-3" />
                <span className="font-mono text-[10px] font-black uppercase tracking-wider">
                  {label}
                </span>
              </div>
              <div className="mt-1 font-black text-xl">{value}</div>
            </div>
          ))}
        </div>
      </BrutalCard>

      {/* Checklist */}
      <BrutalCard variant="white" shadow="default" padding="none">
        <BrutalCardHeader>
          <BrutalCardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" />
            VERIFICATION CHECKLIST
          </BrutalCardTitle>
        </BrutalCardHeader>
        <div className="grid gap-0 divide-y-[3px] divide-black">
          {checklist.map((item) => (
            <div
              key={item.id}
              className={`flex items-start justify-between gap-3 p-3 ${item.passed ? 'bg-white' : 'bg-red-50'}`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 border-[2px] border-black p-0.5 ${item.passed ? 'bg-emerald-400' : 'bg-red-500'}`}
                >
                  {item.passed ? (
                    <CheckCircle2Icon className="size-3 text-black" />
                  ) : (
                    <XCircleIcon className="size-3 text-white" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-black uppercase tracking-wider">
                      {item.label}
                    </span>
                    <Badge
                      variant={
                        item.severity === 'critical'
                          ? 'destructive'
                          : item.severity === 'high'
                            ? 'warning'
                            : 'outline'
                      }
                      className="h-4 px-1.5 text-[9px]"
                    >
                      {item.severity}
                    </Badge>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] leading-tight">{item.message}</p>
                </div>
              </div>
              <div className="shrink-0">
                <Badge variant={item.passed ? 'success' : 'destructive'} className="text-[10px]">
                  {item.passed ? 'PASS' : 'FAIL'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </BrutalCard>

      {/* Diagnostics */}
      <BrutalCard variant="white" shadow="default" padding="none">
        <div className="flex items-center justify-between border-b-[3px] border-black bg-zinc-50 p-3">
          <BrutalCardTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4" />
            DIAGNOSTICS ({filteredDiagnostics.length})
          </BrutalCardTitle>
          <div className="flex gap-1">
            {(['all', 'error', 'warning'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`border-[2px] border-black px-2 py-1 font-mono text-[10px] font-black uppercase transition-all ${
                  filter === f
                    ? 'bg-black text-white shadow-[2px_2px_0px_0px_#00E5FF]'
                    : 'bg-white text-black hover:bg-zinc-100'
                }`}
              >
                {f} {f === 'error' ? `(${categorized.errors.length})` : f === 'warning' ? `(${categorized.warnings.length})` : ''}
              </button>
            ))}
          </div>
        </div>

        {filteredDiagnostics.length === 0 ? (
          <div className="p-6 text-center">
            <div className="mx-auto w-fit border-[3px] border-black bg-emerald-400 p-3 shadow-[3px_3px_0px_0px_black]">
              <CheckCircle2Icon className="size-6" />
            </div>
            <p className="mt-3 font-black uppercase tracking-widest">No issues</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              All checks passed for filter: {filter}
            </p>
          </div>
        ) : (
          <div className="divide-y-[2px] divide-black">
            {Object.entries(groupedByType).map(([type, diags]) => {
              const isExpanded = expandedTypes.has(type)
              return (
                <div key={type} className="bg-white">
                  <button
                    onClick={() => {
                      const next = new Set(expandedTypes)
                      if (isExpanded) next.delete(type)
                      else next.add(type)
                      setExpandedTypes(next)
                    }}
                    className="flex w-full items-center justify-between p-3 text-left hover:bg-zinc-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-black uppercase tracking-wider">
                        {type}
                      </span>
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {diags.length}
                      </Badge>
                    </div>
                    <span className="font-mono text-xs">{isExpanded ? '−' : '+'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t-[2px] border-black bg-zinc-50">
                      {diags.map((diag, idx) => (
                        <div
                          key={`${type}-${idx}`}
                          className="border-b border-black/10 p-3 last:border-b-0"
                        >
                          <div className="flex items-start gap-2">
                            <Badge
                              variant={diag.severity === 'error' ? 'destructive' : 'warning'}
                              className="mt-0.5 h-5 text-[10px]"
                            >
                              {diag.severity}
                            </Badge>
                            <p className="flex-1 font-mono text-[11px] leading-relaxed">
                              {diag.message}
                            </p>
                          </div>
                          {diag.suggestion && (
                            <div className="mt-2 flex gap-2 border-[2px] border-black bg-[#00E5FF]/20 p-2">
                              <LightbulbIcon className="mt-0.5 size-3 shrink-0" />
                              <p className="font-mono text-[11px] leading-tight">
                                <span className="font-black uppercase">Suggestion: </span>
                                {diag.suggestion}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </BrutalCard>

      {/* Assumptions */}
      {design.assumptions.length > 0 && (
        <BrutalCard variant="white" shadow="default" padding="none">
          <BrutalCardHeader>
            <BrutalCardTitle>ENGINEERING ASSUMPTIONS</BrutalCardTitle>
          </BrutalCardHeader>
          <div className="divide-y-[2px] divide-black/10">
            {design.assumptions.map((assumption, idx) => (
              <div key={idx} className="flex gap-2 p-3">
                <span className="font-mono text-[11px] font-black">{idx + 1}.</span>
                <p className="font-mono text-[11px] leading-relaxed">{assumption}</p>
              </div>
            ))}
          </div>
        </BrutalCard>
      )}

      {onRunReview && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRunReview}
          disabled={isReviewing}
          className="w-full"
        >
          {isReviewing ? 'REVIEWING...' : 'RE-RUN DEEP REVIEW'}
        </Button>
      )}
    </div>
  )
}
