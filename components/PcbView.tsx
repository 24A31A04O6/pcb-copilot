'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

import type { CircuitJson } from '@/lib/design'

const PCBViewer = dynamic(
  () => import('@tscircuit/pcb-viewer').then((mod) => mod.PCBViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex size-full items-center justify-center bg-white">
        <div className="border-[3px] border-black bg-[#00E5FF] p-4 shadow-[4px_4px_0px_0px_black] brutal-animate-pulse">
          <div className="font-mono text-xs font-black uppercase tracking-widest">
            Loading PCB Viewer...
          </div>
          <div className="mt-2 h-2 w-32 border-2 border-black bg-white">
            <div className="h-full w-full bg-black brutal-animate-scan" />
          </div>
        </div>
      </div>
    ),
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
    <div ref={containerRef} className="relative size-full min-h-0 overflow-hidden bg-zinc-900">
      {/* Brutal grid overlay */}
      <div className="pointer-events-none absolute inset-0 z-10 opacity-10">
        <div
          className="size-full"
          style={{
            backgroundImage: `linear-gradient(to right, #00E5FF 1px, transparent 1px), linear-gradient(to bottom, #00E5FF 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        />
      </div>
      {/* Live indicator */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 border-[2.5px] border-black bg-white px-2.5 py-1 shadow-[2px_2px_0px_0px_black]">
        <div className="size-2 bg-emerald-500 brutal-live-dot" />
        <span className="font-mono text-[10px] font-black uppercase tracking-widest">PCB • LIVE</span>
      </div>
      <PCBViewer
        circuitJson={circuitJson as never}
        height={height}
        allowEditing={false}
        clickToInteractEnabled
      />
    </div>
  )
}
