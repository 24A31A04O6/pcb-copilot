'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'
import type { CircuitJson } from '@/lib/sample-circuit'

const PCBViewer = dynamic(
  () => import('@tscircuit/pcb-viewer').then((mod) => mod.PCBViewer),
  {
    ssr: false,
    loading: () => <Skeleton className="size-full rounded-none" />,
  },
)

type PcbViewProps = {
  circuitJson: CircuitJson
}

export function PcbView({ circuitJson }: PcbViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(480)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateHeight = () => {
      setHeight(Math.max(element.clientHeight, 240))
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="size-full min-h-0 overflow-hidden bg-black">
      <PCBViewer
        circuitJson={circuitJson as never}
        height={height}
        allowEditing={false}
        clickToInteractEnabled
      />
    </div>
  )
}
