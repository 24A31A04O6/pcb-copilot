'use client'

import { type ReactNode, useState, useEffect } from 'react'
import {
  CheckCircle2Icon,
  Code2Icon,
  DownloadIcon,
  LayersIcon,
  ShieldAlertIcon,
  ZapIcon,
  EyeIcon,
  BoxIcon,
  FileCodeIcon,
  ClipboardCheckIcon,
} from 'lucide-react'

import { PcbView } from '@/components/PcbView'
import { SchematicView } from '@/components/SchematicView'
import { ThreeDView } from '@/components/ThreeDView'
import { ReviewPanel } from '@/components/ReviewPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BrutalCard } from '@/components/ui/brutal-card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DesignResult, DesignDiagnostic } from '@/lib/design'
import { MANUFACTURING_BUNDLE_FILENAME } from '@/lib/exports'

type CircuitViewerProps = {
  design: DesignResult | null
  isGenerating: boolean
  liveCode?: string
  stages?: string[]
  diagnostics?: DesignDiagnostic[]
}

export function CircuitViewer({
  design,
  isGenerating,
  liveCode,
  stages = [],
  diagnostics,
}: CircuitViewerProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewData, setReviewData] = useState<any>(null)
  const [activeTab, setActiveTab] = useState('schematic')

  const status = isGenerating ? 'generating' : design ? 'ready' : 'idle'

  // Auto-switch to schematic when design arrives
  useEffect(() => {
    if (design && !isGenerating) {
      setActiveTab('schematic')
    }
  }, [design, isGenerating])

  async function downloadManufacturingBundle() {
    if (!design?.verified || isExporting) return
    setIsExporting(true)
    setExportError(null)
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tsx: design.tsx,
          summary: design.summary,
          assumptions: design.assumptions,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? 'Manufacturing export failed.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = MANUFACTURING_BUNDLE_FILENAME
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function runDeepReview() {
    if (!design || isReviewing) return
    setIsReviewing(true)
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsx: design.tsx }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? 'Review failed')
      }
      const data = await response.json()
      setReviewData(data)
    } catch (error) {
      console.error('Review failed:', error)
    } finally {
      setIsReviewing(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-2 border-b-[4px] border-black bg-white px-3">
          <TabsList variant="default" className="h-11 min-w-0 overflow-x-auto p-0">
            <TabsTrigger value="schematic" className="gap-1.5">
              <EyeIcon className="size-3.5" />
              Schematic
            </TabsTrigger>
            <TabsTrigger value="pcb" className="gap-1.5">
              <LayersIcon className="size-3.5" />
              PCB
            </TabsTrigger>
            <TabsTrigger value="3d" className="gap-1.5">
              <BoxIcon className="size-3.5" />
              3D
            </TabsTrigger>
            <TabsTrigger value="source" className="gap-1.5">
              <FileCodeIcon className="size-3.5" />
              Source
            </TabsTrigger>
            <TabsTrigger value="review" className="gap-1.5">
              <ClipboardCheckIcon className="size-3.5" />
              Review
            </TabsTrigger>
          </TabsList>
          <div className="flex shrink-0 items-center gap-2">
            {isGenerating ? (
              <Badge variant="live" className="animate-pulse">
                <span className="size-2 bg-[#00E5FF] brutal-live-dot" />
                LIVE
              </Badge>
            ) : (
              <Badge
                variant={
                  design?.verified ? 'success' : design ? 'destructive' : 'secondary'
                }
              >
                {design?.verified ? 'VERIFIED' : design ? 'BLOCKED' : status.toUpperCase()}
              </Badge>
            )}
            {design?.verified ? (
              <Button
                size="sm"
                variant="cyan"
                className="hidden h-8 text-[10px] sm:inline-flex"
                disabled={isExporting}
                onClick={downloadManufacturingBundle}
              >
                <DownloadIcon data-icon="inline-start" />
                {isExporting ? 'PACKAGING' : 'FAB BUNDLE'}
              </Button>
            ) : null}
          </div>
        </header>

        <TabsContent value="schematic" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane
            isGenerating={isGenerating}
            hasCircuit={Boolean(design)}
            stages={stages}
            liveCode={liveCode}
          >
            {design ? <SchematicView circuitJson={design.circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="pcb" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane
            isGenerating={isGenerating}
            hasCircuit={Boolean(design)}
            stages={stages}
            liveCode={liveCode}
          >
            {design ? <PcbView circuitJson={design.circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="3d" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane
            isGenerating={isGenerating}
            hasCircuit={Boolean(design)}
            stages={stages}
            liveCode={liveCode}
          >
            {design ? <ThreeDView circuitJson={design.circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="source" className="min-h-0 flex-1 overflow-auto bg-zinc-50">
          {design ? (
            <div className="space-y-4 p-4">
              {/* Verified Banner */}
              <BrutalCard
                variant={design.verified ? 'cyan' : 'white'}
                shadow="default"
                className="flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    {design.verified ? (
                      <CheckCircle2Icon className="size-5" />
                    ) : (
                      <ShieldAlertIcon className="size-5" />
                    )}
                    <h2 className="font-black text-sm uppercase tracking-wider">
                      {design.verified ? 'Automated checks passed' : 'Manufacturing blocked'}
                    </h2>
                    <Badge variant={design.verified ? 'success' : 'destructive'}>
                      {design.verified ? 'READY' : 'BLOCKED'}
                    </Badge>
                  </div>
                  <p className="max-w-2xl font-mono text-xs leading-relaxed">{design.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{design.stats.components} COMPS</Badge>
                    <Badge variant="outline">{design.stats.sourceTraces} NETS</Badge>
                    <Badge variant="outline">{design.stats.routedTraces} ROUTED</Badge>
                    <Badge variant="outline">{design.iterations} PASSES</Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={design.verified ? 'default' : 'outline'}
                  disabled={!design.verified || isExporting}
                  onClick={downloadManufacturingBundle}
                  className="shrink-0"
                >
                  <DownloadIcon data-icon="inline-start" />
                  {isExporting ? 'PACKAGING...' : 'DOWNLOAD FAB BUNDLE'}
                </Button>
              </BrutalCard>

              {exportError ? (
                <div className="border-[3px] border-black bg-red-500 p-3 font-mono text-xs font-bold text-white shadow-[4px_4px_0px_0px_black]">
                  ⚠ {exportError}
                </div>
              ) : null}

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Components', design.stats.components, '🔧'],
                  ['Nets', design.stats.sourceTraces, '⚡'],
                  ['Routed', design.stats.routedTraces, '🛣️'],
                  ['Repair passes', design.iterations, '🔄'],
                ].map(([label, value, emoji]) => (
                  <div
                    key={label as string}
                    className="border-[3px] border-black bg-white p-3 shadow-[3px_3px_0px_0px_black]"
                  >
                    <p className="font-mono text-[10px] font-black uppercase tracking-wider">
                      {emoji} {label as string}
                    </p>
                    <p className="mt-1 font-black text-2xl">{value as number}</p>
                  </div>
                ))}
              </div>

              {/* Live Diagnostics */}
              {diagnostics && diagnostics.length > 0 && isGenerating && (
                <BrutalCard variant="white" shadow="default" padding="sm">
                  <div className="flex items-center gap-2">
                    <ZapIcon className="size-4" />
                    <span className="font-mono text-xs font-black uppercase">
                      Live Diagnostics: {diagnostics.length} issues
                    </span>
                  </div>
                  <div className="mt-2 max-h-20 overflow-auto">
                    {diagnostics.slice(0, 3).map((d, i) => (
                      <div key={i} className="font-mono text-[11px]">
                        [{d.severity}] {d.message.slice(0, 80)}
                      </div>
                    ))}
                  </div>
                </BrutalCard>
              )}

              {/* Code */}
              <BrutalCard variant="white" shadow="default" padding="none">
                <div className="flex items-center justify-between border-b-[3px] border-black bg-black px-3 py-2">
                  <h3 className="flex items-center gap-2 font-mono text-xs font-black uppercase tracking-widest text-[#00E5FF]">
                    <Code2Icon className="size-4" /> tscircuit TSX • {design.tsx.length} chars
                  </h3>
                  <Badge variant="live" className="text-[10px]">
                    LIVE CODE
                  </Badge>
                </div>
                <pre className="max-h-96 overflow-auto bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-100">
                  <code>{design.tsx}</code>
                </pre>
              </BrutalCard>

              <p className="border-l-[4px] border-[#00E5FF] bg-[#00E5FF]/10 p-3 font-mono text-[11px] leading-relaxed">
                <strong>⚠️ MANUFACTURING DISCLAIMER:</strong> Automated verification is a gate,
                not a substitute for qualified review of datasheets, footprints, thermal limits,
                EMC, regulatory compliance, and fabricator stack-up.
              </p>
            </div>
          ) : (
            <ViewerPane isGenerating={isGenerating} hasCircuit={false} stages={stages} liveCode={liveCode}>
              {null}
            </ViewerPane>
          )}
        </TabsContent>
        <TabsContent value="review" className="min-h-0 flex-1 overflow-auto bg-zinc-50">
          {design ? (
            <ReviewPanel design={design} onRunReview={runDeepReview} isReviewing={isReviewing} />
          ) : (
            <ViewerPane isGenerating={isGenerating} hasCircuit={false} stages={stages} liveCode={liveCode}>
              {null}
            </ViewerPane>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function ViewerPane({
  isGenerating,
  hasCircuit,
  children,
  stages,
  liveCode,
}: {
  isGenerating: boolean
  hasCircuit: boolean
  children: ReactNode
  stages?: string[]
  liveCode?: string
}) {
  if (isGenerating) {
    return (
      <div className="relative flex size-full min-h-0 flex-col bg-white">
        {/* Live generation header */}
        <div className="border-b-[3px] border-black bg-black p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-3 bg-[#00E5FF] brutal-live-dot" />
              <span className="font-mono text-xs font-black uppercase tracking-widest text-[#00E5FF]">
                LIVE GENERATION ACTIVE
              </span>
              <Badge variant="live" className="bg-[#00E5FF] text-black">
                GENERATING
              </Badge>
            </div>
            <div className="font-mono text-[10px] text-white/60">
              {stages?.length ? stages[stages.length - 1] : 'INITIALIZING...'}
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-2 border-2 border-[#00E5FF] bg-zinc-900">
            <div className="h-full w-full bg-[#00E5FF] brutal-animate-shimmer" />
          </div>
        </div>

        {/* Live preview grid */}
        <div className="grid flex-1 grid-cols-1 gap-0 sm:grid-cols-3">
          <div className="relative border-b-[3px] border-black sm:border-b-0 sm:border-r-[3px]">
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 gap-px bg-zinc-100 p-2">
              {Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white"
                  style={{
                    animation: `brutal-pulse ${0.5 + Math.random()}s ease-in-out infinite`,
                    animationDelay: `${Math.random() * 2}s`,
                  }}
                />
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="border-[3px] border-black bg-[#00E5FF] px-3 py-1.5 shadow-[4px_4px_0px_0px_black]">
                <span className="font-mono text-[10px] font-black uppercase">Schematic • Building</span>
              </div>
            </div>
          </div>
          <div className="relative border-b-[3px] border-black sm:border-b-0 sm:border-r-[3px]">
            <div className="absolute inset-0 bg-zinc-900 p-2">
              <div className="size-full border-2 border-dashed border-[#00E5FF]/30">
                <div className="size-full brutal-animate-grid bg-[linear-gradient(to_right,#00E5FF20_1px,transparent_1px),linear-gradient(to_bottom,#00E5FF20_1px,transparent_1px)] bg-[size:20px_20px]" />
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="border-[3px] border-[#00E5FF] bg-black px-3 py-1.5 shadow-[4px_4px_0px_0px_#00E5FF]">
                <span className="font-mono text-[10px] font-black uppercase text-[#00E5FF]">
                  PCB • Routing
                </span>
              </div>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 bg-black p-2">
              <div className="flex size-full items-center justify-center">
                <div className="size-16 border-[3px] border-[#00E5FF] bg-transparent brutal-animate-pulse" />
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="border-[3px] border-[#00E5FF] bg-black px-3 py-1.5 shadow-[4px_4px_0px_0px_#00E5FF]">
                <span className="font-mono text-[10px] font-black uppercase text-[#00E5FF]">
                  3D • Assembling
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stages */}
        <div className="border-t-[3px] border-black bg-white p-3">
          <div className="flex gap-2 overflow-x-auto">
            {(stages?.slice(-4) ?? ['Reviewing requirements', 'Generating TSX', 'Compiling', 'Verifying']).map(
              (stage, idx) => (
                <div
                  key={idx}
                  className="shrink-0 border-[2.5px] border-black bg-[#00E5FF] px-3 py-1.5 font-mono text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_black]"
                >
                  {idx + 1}. {stage}
                </div>
              ),
            )}
          </div>
        </div>

        {/* Live code */}
        {liveCode && (
          <div className="max-h-24 overflow-hidden border-t-[3px] border-black bg-zinc-950 p-2">
            <div className="font-mono text-[10px] leading-relaxed text-emerald-400">
              {liveCode.slice(-200)}
              <span className="ml-1 inline-block h-3 w-2 bg-[#00E5FF] brutal-animate-blink" />
            </div>
          </div>
        )}
      </div>
    )
  }
  if (!hasCircuit) {
    return (
      <Empty className="size-full min-h-0 rounded-none border-[3px] border-black bg-white">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="border-[3px] border-black bg-[#00E5FF] shadow-[4px_4px_0px_0px_black]">
            <LayersIcon className="text-black" />
          </EmptyMedia>
          <EmptyTitle className="font-black uppercase tracking-widest">No compiled design</EmptyTitle>
          <EmptyDescription className="font-mono text-xs">
            Schematic, routed board, 3D assembly, source, checks, and manufacturing exports appear after
            the agent compiles a design. Start by describing your board.
          </EmptyDescription>
          <div className="mt-4 flex gap-2">
            <Badge variant="outline">AWAITING BRIEF</Badge>
            <Badge variant="default">READY TO GENERATE</Badge>
          </div>
        </EmptyHeader>
      </Empty>
    )
  }
  return <div className="size-full min-h-0">{children}</div>
}
