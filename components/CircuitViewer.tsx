'use client'

import type { ReactNode } from 'react'
import { LayersIcon } from 'lucide-react'
import type { CircuitJson } from '@/lib/sample-circuit'

import { PcbView } from '@/components/PcbView'
import { SchematicView } from '@/components/SchematicView'
import { ThreeDView } from '@/components/ThreeDView'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type CircuitViewerProps = {
  circuitJson: CircuitJson | null
  isGenerating: boolean
}

export function CircuitViewer({
  circuitJson,
  isGenerating,
}: CircuitViewerProps) {
  const status = isGenerating ? 'generating' : circuitJson ? 'ready' : 'idle'

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <Tabs
        defaultValue="schematic"
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
          <TabsList variant="line" className="h-11 p-0">
            <TabsTrigger
              value="schematic"
              className="font-mono text-[11px] tracking-[0.16em] uppercase"
            >
              Schematic
            </TabsTrigger>
            <TabsTrigger
              value="pcb"
              className="font-mono text-[11px] tracking-[0.16em] uppercase"
            >
              PCB Layout
            </TabsTrigger>
            <TabsTrigger
              value="3d"
              className="font-mono text-[11px] tracking-[0.16em] uppercase"
            >
              3D View
            </TabsTrigger>
          </TabsList>
          <Badge variant={status === 'ready' ? 'default' : 'secondary'}>
            {status}
          </Badge>
        </header>

        <TabsContent
          value="schematic"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ViewerPane isGenerating={isGenerating} hasCircuit={Boolean(circuitJson)}>
            {circuitJson ? <SchematicView circuitJson={circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="pcb" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane isGenerating={isGenerating} hasCircuit={Boolean(circuitJson)}>
            {circuitJson ? <PcbView circuitJson={circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
        <TabsContent value="3d" className="min-h-0 flex-1 overflow-hidden">
          <ViewerPane isGenerating={isGenerating} hasCircuit={Boolean(circuitJson)}>
            {circuitJson ? <ThreeDView circuitJson={circuitJson} /> : null}
          </ViewerPane>
        </TabsContent>
      </Tabs>
    </section>
  )
}

function ViewerPane({
  isGenerating,
  hasCircuit,
  children,
}: {
  isGenerating: boolean
  hasCircuit: boolean
  children: ReactNode
}) {
  if (isGenerating) {
    return (
      <div className="flex size-full min-h-0 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
        <div className="grid grid-cols-4 gap-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      </div>
    )
  }

  if (!hasCircuit) {
    return (
      <Empty className="size-full min-h-0 rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayersIcon />
          </EmptyMedia>
          <EmptyTitle>Describe a circuit to get started</EmptyTitle>
          <EmptyDescription>
            Schematic, board, and 3D views will render here after a prompt is
            generated.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return <div className="size-full min-h-0">{children}</div>
}
