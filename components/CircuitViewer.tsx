'use client'

import { type ReactNode, useState } from 'react'
import {
  CheckCircle2Icon,
  Code2Icon,
  DownloadIcon,
  LayersIcon,
  ShieldAlertIcon,
} from 'lucide-react'

import { PcbView } from '@/components/PcbView'
import { SchematicView } from '@/components/SchematicView'
import { ThreeDView } from '@/components/ThreeDView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DesignResult } from '@/lib/design'
import { MANUFACTURING_BUNDLE_FILENAME } from '@/lib/exports'

type CircuitViewerProps = {
  design: DesignResult | null
  isGenerating: boolean
}

export function CircuitViewer({ design, isGenerating }: CircuitViewerProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const status = isGenerating ? 'generating' : design ? 'ready' : 'idle'

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

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <Tabs defaultValue="schematic" className="flex h-full min-h-0 flex-col gap-0">
        <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
          <TabsList variant="line" className="h-11 min-w-0 overflow-x-auto p-0">
            <TabsTrigger value="schematic" className="font-mono text-[10px] tracking-[0.12em] uppercase">
              Schematic
            </TabsTrigger>
            <TabsTrigger value="pcb" className="font-mono text-[10px] tracking-[0.12em] uppercase">
              PCB
            </TabsTrigger>
            <TabsTrigger value="3d" className="font-mono text-[10px] tracking-[0.12em] uppercase">
              3D
            </TabsTrigger>
            <TabsTrigger value="source" className="font-mono text-[10px] tracking-[0.12em] uppercase">
              Source + checks
            </TabsTrigger>
          </TabsList>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={design?.verified ? 'default' : 'secondary'}>
              {design?.verified ? 'verified' : status}
            </Badge>
            {design?.verified ? (
              <Button
                size="sm"
                className="hidden h-7 font-mono text-[10px] uppercase sm:inline-flex"
                disabled={isExporting}
                onClick={downloadManufacturingBundle}
              >
                <DownloadIcon data-icon="inline-start" />
                {isExporting ? 'Packaging' : 'Fab bundle'}
              </Button>
            ) : null}
          </div>
        </header>

        <TabsContent value="schematic" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane isGenerating={isGenerating} hasCircuit={Boolean(design)}>
            {design ? <SchematicView circuitJson={design.circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="pcb" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane isGenerating={isGenerating} hasCircuit={Boolean(design)}>
            {design ? <PcbView circuitJson={design.circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="3d" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane isGenerating={isGenerating} hasCircuit={Boolean(design)}>
            {design ? <ThreeDView circuitJson={design.circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="source" className="min-h-0 flex-1 overflow-auto">
          {design ? (
            <div className="space-y-5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    {design.verified ? (
                      <CheckCircle2Icon className="size-4 text-emerald-600" />
                    ) : (
                      <ShieldAlertIcon className="size-4 text-destructive" />
                    )}
                    <h2 className="font-mono text-xs font-semibold uppercase">
                      {design.verified ? 'Automated checks passed' : 'Manufacturing blocked'}
                    </h2>
                  </div>
                  <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    {design.summary}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!design.verified || isExporting}
                  onClick={downloadManufacturingBundle}
                >
                  <DownloadIcon data-icon="inline-start" />
                  {isExporting ? 'Packaging…' : 'Download fab bundle'}
                </Button>
              </div>

              {exportError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  {exportError}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Components', design.stats.components],
                  ['Nets', design.stats.sourceTraces],
                  ['Routed', design.stats.routedTraces],
                  ['Repair passes', design.iterations],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{label}</p>
                    <p className="mt-1 font-mono text-lg">{value}</p>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="mb-2 font-mono text-[11px] tracking-wider uppercase">
                  Verification report
                </h3>
                {design.diagnostics.length === 0 ? (
                  <p className="rounded-md border border-emerald-600/30 bg-emerald-500/5 p-3 text-xs text-emerald-700">
                    No compiler, connectivity, placement, or routing diagnostics.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {design.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.type}-${index}`} className="rounded-md border p-3 font-mono text-[11px]">
                        <Badge variant={diagnostic.severity === 'error' ? 'destructive' : 'outline'} className="mr-2">
                          {diagnostic.severity}
                        </Badge>
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-wider uppercase">
                  <Code2Icon className="size-3.5" /> tscircuit TSX
                </h3>
                <pre className="max-h-96 overflow-auto rounded-lg border bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100">
                  <code>{design.tsx}</code>
                </pre>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Automated verification is a manufacturing gate, not a substitute for qualified review of datasheets, footprints, thermal limits, EMC, regulatory compliance, and the fabricator&apos;s stack-up.
              </p>
            </div>
          ) : (
            <ViewerPane isGenerating={isGenerating} hasCircuit={false}>
              {null}
            </ViewerPane>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function ViewerPane({ isGenerating, hasCircuit, children }: { isGenerating: boolean; hasCircuit: boolean; children: ReactNode }) {
  if (isGenerating) {
    return (
      <div className="flex size-full min-h-0 flex-col gap-3 p-4">
        <div className="flex items-center justify-between"><Skeleton className="h-3 w-28" /><Skeleton className="h-3 w-16" /></div>
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
        <div className="grid grid-cols-4 gap-2"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
      </div>
    )
  }
  if (!hasCircuit) {
    return (
      <Empty className="size-full min-h-0 rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon"><LayersIcon /></EmptyMedia>
          <EmptyTitle>No compiled design</EmptyTitle>
          <EmptyDescription>Schematic, routed board, 3D assembly, source, checks, and manufacturing exports appear after the agent compiles a design.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return <div className="size-full min-h-0">{children}</div>
}
