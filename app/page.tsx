'use client'

import { useState } from 'react'

import { CircuitViewer } from '@/components/CircuitViewer'
import { PromptChat } from '@/components/PromptChat'
import { Badge } from '@/components/ui/badge'
import type { ChatMessage } from '@/lib/chat'
import type { DesignResult, DesignStreamEvent } from '@/lib/design'

export default function Page() {
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  async function handleGenerate(prompt: string) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setIsGenerating(true)

    const addMessage = (message: Omit<ChatMessage, 'id'>) => {
      setMessages((current) => [
        ...current,
        { ...message, id: crypto.randomUUID() },
      ])
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
          addMessage({ role: 'status', content: event.message, tone: 'info' })
        } else if (event.type === 'clarification') {
          addMessage({
            role: 'assistant',
            content: `I need ${event.questions.length === 1 ? 'one detail' : 'a few critical details'} before routing:\n${event.questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`,
          })
        } else if (event.type === 'result') {
          setDesign(event.design)
          addMessage({
            role: 'status',
            content: event.design.verified
              ? `Verified after ${event.design.iterations} pass${event.design.iterations === 1 ? '' : 'es'}`
              : 'Design generated with unresolved blocking checks',
            tone: event.design.verified ? 'success' : 'error',
          })
        } else {
          throw new Error(event.message)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) processEvent(JSON.parse(line) as DesignStreamEvent)
        }
        if (done) break
      }
      if (buffer.trim()) processEvent(JSON.parse(buffer) as DesignStreamEvent)
    } catch (error) {
      addMessage({
        role: 'status',
        content: error instanceof Error ? error.message : 'Generation failed',
        tone: 'error',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const blockingIssues =
    design?.diagnostics.filter((item) => item.severity === 'error').length ?? 0

  return (
    <div className="flex h-svh min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-sm tracking-[0.28em] text-foreground uppercase">
            pcb-copilot
          </h1>
          <p className="hidden font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase sm:block">
            Fireworks + tscircuit
          </p>
        </div>
        <Badge
          variant={
            isGenerating
              ? 'secondary'
              : design?.verified
                ? 'default'
                : blockingIssues > 0
                  ? 'destructive'
                  : 'outline'
          }
        >
          {isGenerating
            ? 'agent working'
            : design?.verified
              ? 'manufacturing ready'
              : blockingIssues > 0
                ? `${blockingIssues} blocked`
                : 'awaiting brief'}
        </Badge>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="h-[42vh] min-h-0 border-b md:h-auto md:w-[38%] md:border-r md:border-b-0">
          <PromptChat
            messages={messages}
            isGenerating={isGenerating}
            onSubmit={handleGenerate}
          />
        </div>
        <div className="min-h-0 flex-1 md:w-[62%]">
          <CircuitViewer design={design} isGenerating={isGenerating} />
        </div>
      </div>
    </div>
  )
}
