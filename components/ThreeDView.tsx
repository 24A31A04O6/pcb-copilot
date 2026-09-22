'use client'

import dynamic from 'next/dynamic'

import type { CircuitJson } from '@/lib/design'

const CadViewer = dynamic(
  () => import('@tscircuit/3d-viewer').then((mod) => mod.CadViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex size-full items-center justify-center bg-black">
        <div className="border-[3px] border-[#00E5FF] bg-black p-4 shadow-[4px_4px_0px_0px_#00E5FF] brutal-animate-pulse">
          <div className="font-mono text-xs font-black uppercase tracking-widest text-[#00E5FF]">
            Loading 3D...
          </div>
          <div className="mt-2 h-1 w-24 overflow-hidden border border-[#00E5FF]">
            <div className="h-full w-full bg-[#00E5FF] brutal-animate-scan" />
          </div>
        </div>
      </div>
    ),
  },
)

type ThreeDViewProps = {
  circuitJson: CircuitJson
}

export function ThreeDView({ circuitJson }: ThreeDViewProps) {
  return (
    <div className="relative size-full min-h-0 overflow-hidden bg-zinc-900">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 border-[2.5px] border-[#00E5FF] bg-black px-2.5 py-1 shadow-[2px_2px_0px_0px_#00E5FF]">
        <div className="size-2 bg-[#00E5FF] brutal-live-dot" />
        <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">
          3D • LIVE
        </span>
      </div>
      <CadViewer circuitJson={circuitJson} />
    </div>
  )
}
