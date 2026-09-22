'use client'

import dynamic from 'next/dynamic'

import type { CircuitJson } from '@/lib/design'

const SchematicViewer = dynamic(
  () =>
    import('@tscircuit/schematic-viewer').then((mod) => mod.SchematicViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex size-full items-center justify-center bg-white">
        <div className="border-[3px] border-black bg-[#00E5FF] p-4 shadow-[4px_4px_0px_0px_black] brutal-animate-pulse">
          <div className="font-mono text-xs font-black uppercase tracking-widest">
            Loading Schematic...
          </div>
          <div className="mt-2 flex gap-1">
            <div className="size-2 bg-black brutal-animate-blink" />
            <div className="size-2 bg-black brutal-animate-blink [animation-delay:0.2s]" />
            <div className="size-2 bg-black brutal-animate-blink [animation-delay:0.4s]" />
          </div>
        </div>
      </div>
    ),
  },
)

type SchematicViewProps = {
  circuitJson: CircuitJson
}

export function SchematicView({ circuitJson }: SchematicViewProps) {
  return (
    <div className="relative size-full min-h-0 overflow-hidden bg-white">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 border-[2.5px] border-black bg-black px-2.5 py-1 shadow-[2px_2px_0px_0px_#00E5FF]">
        <div className="size-2 bg-[#00E5FF] brutal-live-dot" />
        <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">
          SCHEMATIC • LIVE
        </span>
      </div>
      <SchematicViewer
        circuitJson={circuitJson as never}
        clickToInteractEnabled
        containerStyle={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
