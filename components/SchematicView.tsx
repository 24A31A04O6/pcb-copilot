'use client'

import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'
import type { CircuitJson } from '@/lib/sample-circuit'

const SchematicViewer = dynamic(
  () =>
    import('@tscircuit/schematic-viewer').then((mod) => mod.SchematicViewer),
  {
    ssr: false,
    loading: () => <Skeleton className="size-full rounded-none" />,
  },
)

type SchematicViewProps = {
  circuitJson: CircuitJson
}

export function SchematicView({ circuitJson }: SchematicViewProps) {
  return (
    <div className="size-full min-h-0 overflow-hidden bg-background">
      <SchematicViewer
        circuitJson={circuitJson as never}
        clickToInteractEnabled
        containerStyle={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
