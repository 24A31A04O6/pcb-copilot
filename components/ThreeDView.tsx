'use client'

import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'
import type { CircuitJson } from '@/lib/design'

const CadViewer = dynamic(
  () => import('@tscircuit/3d-viewer').then((mod) => mod.CadViewer),
  {
    ssr: false,
    loading: () => <Skeleton className="size-full rounded-none" />,
  },
)

type ThreeDViewProps = {
  circuitJson: CircuitJson
}

export function ThreeDView({ circuitJson }: ThreeDViewProps) {
  return (
    <div className="size-full min-h-0 overflow-hidden bg-black">
      <CadViewer circuitJson={circuitJson} />
    </div>
  )
}
