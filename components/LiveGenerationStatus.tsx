'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { BrutalCard } from '@/components/ui/brutal-card'

type LiveGenerationStatusProps = {
  isGenerating: boolean
  stages: string[]
  currentCode?: string
  diagnosticsCount?: number
  progress?: number
}

export function LiveGenerationStatus({
  isGenerating,
  stages,
  currentCode,
  diagnosticsCount = 0,
  progress,
}: LiveGenerationStatusProps) {
  const [dots, setDots] = useState('')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0)
      return
    }
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
      setElapsed((e) => e + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [isGenerating])

  if (!isGenerating && stages.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Live indicator */}
      {isGenerating && (
        <BrutalCard variant="black" shadow="cyan" padding="sm" className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-full bg-[#00E5FF] brutal-live-dot" />
            <span className="font-black text-xs uppercase tracking-widest text-[#00E5FF]">
              LIVE GENERATION
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-white/70">
              {Math.floor(elapsed / 2)}s elapsed
            </span>
            {progress !== undefined && (
              <Badge variant="live" className="text-[10px]">
                {Math.round(progress)}%
              </Badge>
            )}
          </div>
        </BrutalCard>
      )}

      {/* Stages timeline */}
      <div className="space-y-2">
        {stages.slice(-5).map((stage, idx) => {
          const isLast = idx === stages.slice(-5).length - 1
          const isCurrent = isGenerating && isLast
          return (
            <div
              key={`${stage}-${idx}`}
              className={`flex items-start gap-3 border-[2.5px] border-black p-2.5 text-xs transition-all ${
                isCurrent
                  ? 'bg-[#00E5FF] text-black shadow-[3px_3px_0px_0px_black] brutal-animate-pulse'
                  : 'bg-white text-black shadow-[2px_2px_0px_0px_black]'
              }`}
            >
              <div
                className={`mt-0.5 size-2 shrink-0 border-[1.5px] border-black ${
                  isCurrent ? 'bg-black brutal-live-dot' : 'bg-zinc-200'
                }`}
              />
              <span className="font-mono font-bold uppercase leading-tight tracking-wide">
                {stage}
                {isCurrent ? dots : ''}
              </span>
              {isCurrent && (
                <div className="ml-auto h-1 w-12 overflow-hidden border border-black bg-white">
                  <div className="h-full w-full bg-black brutal-animate-scan" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Live code preview */}
      {isGenerating && currentCode && (
        <BrutalCard variant="white" shadow="default" padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b-[3px] border-black bg-black px-3 py-1.5">
            <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">
              TSX STREAMING
            </span>
            <div className="flex gap-1">
              <div className="size-2 border border-white bg-red-500" />
              <div className="size-2 border border-white bg-yellow-400" />
              <div className="size-2 border border-white bg-emerald-400" />
            </div>
          </div>
          <div className="relative max-h-32 overflow-hidden bg-zinc-950 p-3">
            <pre className="font-mono text-[10px] leading-relaxed text-emerald-400">
              <code>{currentCode.slice(-500)}</code>
              <span className="inline-block h-3 w-2 bg-[#00E5FF] brutal-animate-blink" />
            </pre>
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-zinc-950 to-transparent" />
          </div>
        </BrutalCard>
      )}

      {/* Diagnostics live count */}
      {diagnosticsCount > 0 && (
        <div className="flex gap-2">
          <Badge variant={diagnosticsCount > 0 ? 'destructive' : 'success'} className="font-mono">
            {diagnosticsCount} ISSUES DETECTED
          </Badge>
        </div>
      )}
    </div>
  )
}
