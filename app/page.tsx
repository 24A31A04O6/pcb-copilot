'use client'

import { useState } from 'react'

import { CircuitViewer } from '@/components/CircuitViewer'
import { PromptChat } from '@/components/PromptChat'
import { Badge } from '@/components/ui/badge'
import type { ChatMessage } from '@/lib/chat'
import { SAMPLE_CIRCUIT_JSON, SAMPLE_CIRCUIT_TSX } from '@/lib/sample-circuit'

export default function Page() {
  const [circuitTsx, setCircuitTsx] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const circuitJson = circuitTsx ? SAMPLE_CIRCUIT_JSON : null

  async function handleGenerate(prompt: string) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
    }
    const generatingMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'status',
      content: 'Generating circuit...',
      tone: 'info',
    }

    setMessages((current) => [...current, userMessage, generatingMessage])
    setIsGenerating(true)

    try {
      await new Promise((resolve) => setTimeout(resolve, 900))
      setCircuitTsx(SAMPLE_CIRCUIT_TSX)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'status',
          content: 'Done',
          tone: 'success',
        },
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'status',
          content:
            error instanceof Error ? error.message : 'Generation failed',
          tone: 'error',
        },
      ])
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex h-svh min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-sm tracking-[0.28em] text-foreground uppercase">
            pcb-copilot
          </h1>
          <p className="hidden font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase sm:block">
            Ref. sch-01
          </p>
        </div>
        <Badge variant={circuitJson ? 'default' : 'outline'}>
          {isGenerating ? 'busy' : circuitJson ? 'board loaded' : 'awaiting prompt'}
        </Badge>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="h-[42vh] min-h-0 border-b md:h-auto md:w-[40%] md:border-r md:border-b-0">
          <PromptChat
            messages={messages}
            isGenerating={isGenerating}
            onSubmit={handleGenerate}
          />
        </div>
        <div className="min-h-0 flex-1 md:w-[60%]">
          <CircuitViewer circuitJson={circuitJson} isGenerating={isGenerating} />
        </div>
      </div>
    </div>
  )
}
