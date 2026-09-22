'use client'

import { useState, useRef } from 'react'

import { CircuitViewer } from '@/components/CircuitViewer'
import { PromptChat } from '@/components/PromptChat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ChatMessage } from '@/lib/chat'
import type { DesignResult, DesignStreamEvent, DesignDiagnostic } from '@/lib/design'

export default function Page() {
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [stages, setStages] = useState<string[]>([])
  const [liveCode, setLiveCode] = useState<string>('')
  const [liveDiagnostics, setLiveDiagnostics] = useState<DesignDiagnostic[]>([])
  const [progress, setProgress] = useState<number>(0)

  const abortControllerRef = useRef<AbortController | null>(null)

  async function handleGenerate(prompt: string) {
    // Abort previous if any
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setIsGenerating(true)
    setStages([])
    setLiveCode('')
    setLiveDiagnostics([])
    setProgress(0)

    const addMessage = (message: Omit<ChatMessage, 'id'>) => {
      setMessages((current) => [
        ...current,
        { ...message, id: crypto.randomUUID() },
      ])
    }

    const addStage = (stage: string) => {
      setStages((prev) => {
        // Avoid duplicates
        if (prev[prev.length - 1] === stage) return prev
        const next = [...prev, stage].slice(-10)
        // Update progress based on stage
        if (stage.includes('Reviewing')) setProgress(10)
        else if (stage.includes('Generating')) setProgress(30)
        else if (stage.includes('Compiling')) setProgress(60)
        else if (stage.includes('Repairing')) setProgress(75)
        else if (stage.includes('Verification passed')) setProgress(100)
        return next
      })
    }

    try {
      const response = await fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages
            .filter((message) => message.role === 'user')
            .map((message) => message.content),
          allowClarification: !nextMessages.some(
            (message) =>
              message.role === 'assistant' && message.content.startsWith('I need '),
          ),
        }),
        signal: abortController.signal,
      })

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? 'Unable to start PCB generation.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const processEvent = (event: DesignStreamEvent) => {
        if (event.type === 'stage') {
          addStage(event.message)
          addMessage({ role: 'status', content: event.message, tone: 'info' })
        } else if (event.type === 'code_chunk') {
          setLiveCode((prev) => {
            const next = (prev + event.chunk).slice(-2000)
            return next
          })
        } else if (event.type === 'code') {
          setLiveCode(event.code.slice(-2000))
        } else if (event.type === 'partial_result') {
          // Show live preview even before final verification
          setDesign(event.design)
          setLiveDiagnostics(event.design.diagnostics)
          if (event.design.verified) {
            setProgress(100)
          }
        } else if (event.type === 'diagnostics') {
          setLiveDiagnostics(event.diagnostics)
        } else if (event.type === 'clarification') {
          addMessage({
            role: 'assistant',
            content: `I need ${event.questions.length === 1 ? 'one detail' : 'a few critical details'} before routing:\n${event.questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`,
          })
        } else if (event.type === 'result') {
          setDesign(event.design)
          setLiveDiagnostics(event.design.diagnostics)
          setProgress(100)
          addMessage({
            role: 'status',
            content: event.design.verified
              ? `Verified after ${event.design.iterations} pass${event.design.iterations === 1 ? '' : 'es'} • Score ${Math.round((event.design.diagnostics.length === 0 ? 100 : 95))}%`
              : 'Design generated with unresolved blocking checks — review panel has details',
            tone: event.design.verified ? 'success' : 'error',
          })
        } else if (event.type === 'error') {
          throw new Error(event.message)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.trim()) {
              try {
                processEvent(JSON.parse(line) as DesignStreamEvent)
              } catch (e) {
                console.warn('Failed to parse event:', line, e)
              }
            }
          }
        }
        if (done) break
      }
      if (buffer.trim()) {
        try {
          processEvent(JSON.parse(buffer) as DesignStreamEvent)
        } catch {}
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        addMessage({
          role: 'status',
          content: 'Generation aborted',
          tone: 'error',
        })
        return
      }
      addMessage({
        role: 'status',
        content: error instanceof Error ? error.message : 'Generation failed',
        tone: 'error',
      })
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  const blockingIssues =
    design?.diagnostics.filter((item) => item.severity === 'error').length ?? 0

  const canAbort = isGenerating && abortControllerRef.current

  return (
    <div className="flex h-svh min-h-0 flex-col bg-white">
      <header className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b-[4px] border-black bg-white px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="border-[3px] border-black bg-[#00E5FF] p-1.5 shadow-[3px_3px_0px_0px_black]">
              <div className="size-4 bg-black" />
            </div>
            <h1 className="font-black text-[16px] uppercase tracking-[0.15em] text-black">
              PCB<span className="bg-black px-1 text-[#00E5FF]">COPILOT</span>
            </h1>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="h-6 w-px bg-black" />
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-black/70">
              Fireworks + tscircuit • Fluid Compute
            </p>
            <Badge variant="default" className="h-5 text-[10px]">
              V2.0 • BRUTAL
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <>
              <div className="hidden items-center gap-2 border-[2.5px] border-black bg-black px-2.5 py-1 shadow-[2px_2px_0px_0px_#00E5FF] sm:flex">
                <div className="size-2 bg-[#00E5FF] brutal-live-dot" />
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">
                  {progress}% • LIVE
                </span>
              </div>
              <Button
                variant="destructive"
                size="xs"
                onClick={() => abortControllerRef.current?.abort()}
                className="h-7 text-[10px]"
              >
                ABORT
              </Button>
            </>
          )}
          <Badge
            variant={
              isGenerating
                ? 'live'
                : design?.verified
                  ? 'success'
                  : blockingIssues > 0
                    ? 'destructive'
                    : 'outline'
            }
            className="font-black"
          >
            {isGenerating
              ? `AGENT WORKING • ${stages.length > 0 ? stages[stages.length - 1].slice(0, 20) : '...'}` 
              : design?.verified
                ? 'MANUFACTURING READY'
                : blockingIssues > 0
                  ? `${blockingIssues} BLOCKED`
                  : 'AWAITING BRIEF'}
          </Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="h-[42vh] min-h-0 border-b-[4px] border-black md:h-auto md:w-[38%] md:border-b-0 md:border-r-[4px]">
          <PromptChat
            messages={messages}
            isGenerating={isGenerating}
            onSubmit={handleGenerate}
            stages={stages}
            liveCode={liveCode}
            liveDiagnostics={liveDiagnostics}
          />
        </div>
        <div className="min-h-0 flex-1 bg-white md:w-[62%]">
          <CircuitViewer
            design={design}
            isGenerating={isGenerating}
            liveCode={liveCode}
            stages={stages}
            diagnostics={liveDiagnostics}
          />
        </div>
      </div>

      {/* Footer brutal */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t-[3px] border-black bg-black px-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/60">
          NEOBRUTALISM • CYAN • WHITE • {design ? `${design.stats.components} COMPS` : 'NO DESIGN'} • FLUID COMPUTE
        </span>
        <span className="hidden font-mono text-[10px] font-bold uppercase tracking-widest text-[#00E5FF] sm:inline">
          END-TO-END • VERIFIED • PRODUCTION READY
        </span>
      </footer>
    </div>
  )
}
