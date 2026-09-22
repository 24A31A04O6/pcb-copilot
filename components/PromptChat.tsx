'use client'

import { useRef, useState, useEffect } from 'react'
import { CircuitBoardIcon, ZapIcon, SendIcon } from 'lucide-react'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BrutalCard } from '@/components/ui/brutal-card'
import { Kbd } from '@/components/ui/kbd'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
import type { ChatMessage } from '@/lib/chat'
import { LiveGenerationStatus } from '@/components/LiveGenerationStatus'
import type { DesignDiagnostic } from '@/lib/design'

type PromptChatProps = {
  messages: ChatMessage[]
  isGenerating: boolean
  onSubmit: (prompt: string) => void
  stages?: string[]
  liveCode?: string
  liveDiagnostics?: DesignDiagnostic[]
}

export function PromptChat({
  messages,
  isGenerating,
  onSubmit,
  stages = [],
  liveCode,
  liveDiagnostics,
}: PromptChatProps) {
  const [value, setValue] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function submitPrompt() {
    const prompt = value.trim()
    if (!prompt || isGenerating) return
    onSubmit(prompt)
    setValue('')
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b-[4px] border-black bg-black px-4">
        <div className="flex items-center gap-3">
          <div className="border-2 border-[#00E5FF] bg-[#00E5FF] p-1.5">
            <CircuitBoardIcon className="size-4 text-black" />
          </div>
          <p className="font-black text-xs uppercase tracking-[0.2em] text-[#00E5FF]">
            Engineering brief
          </p>
          {isGenerating && (
            <Badge variant="live" className="border-[#00E5FF] bg-black text-[#00E5FF]">
              <span className="size-2 bg-[#00E5FF] brutal-live-dot" />
              LIVE
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/70">
            {messages.filter((m) => m.role === 'user').length} INPUTS
          </p>
          <div className="size-2 bg-[#00E5FF] brutal-live-dot" />
        </div>
      </header>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1 bg-zinc-50">
          <MessageScrollerViewport>
            <MessageScrollerContent className="justify-end gap-4 p-4">
              {messages.length === 0 ? (
                <MessageScrollerItem messageId="empty">
                  <BrutalCard variant="white" shadow="lg" className="min-h-64 border-dashed">
                    <Empty className="min-h-48 border-0 bg-transparent">
                      <EmptyHeader>
                        <EmptyMedia
                          variant="icon"
                          className="border-[3px] border-black bg-[#00E5FF] shadow-[4px_4px_0px_0px_black]"
                        >
                          <CircuitBoardIcon className="text-black" />
                        </EmptyMedia>
                        <EmptyTitle className="font-black uppercase tracking-widest">
                          Describe the board you need
                        </EmptyTitle>
                        <EmptyDescription className="font-mono text-xs leading-relaxed">
                          Fireworks writes real tscircuit source, compiles it, runs connectivity and
                          layout checks, repairs failures, and unlocks fabrication files only after
                          verification.
                        </EmptyDescription>
                        <div className="mt-4 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
                          {[
                            '5V USB-C sensor board, 40×25mm',
                            'ESP32 dev board with LiPo charger',
                            'Motor driver 12V 5A with current sense',
                            'LED matrix 8x8 with shift registers',
                          ].map((example) => (
                            <button
                              key={example}
                              onClick={() => setValue(example)}
                              className="border-[2.5px] border-black bg-white p-2.5 text-left font-mono text-[11px] font-bold uppercase leading-tight shadow-[2px_2px_0px_0px_black] transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_black] hover:bg-[#00E5FF]"
                            >
                              → {example}
                            </button>
                          ))}
                        </div>
                      </EmptyHeader>
                    </Empty>
                  </BrutalCard>
                </MessageScrollerItem>
              ) : (
                <>
                  {messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === 'user'}
                    >
                      {message.role === 'user' || message.role === 'assistant' ? (
                        <Message align={message.role === 'user' ? 'end' : 'start'}>
                          <MessageContent>
                            <div
                              className={`max-w-[85%] border-[3px] border-black p-3 shadow-[4px_4px_0px_0px_black] ${
                                message.role === 'user'
                                  ? 'bg-[#00E5FF] text-black'
                                  : 'bg-white text-black'
                              }`}
                            >
                              <div className="flex items-center gap-2 border-b-[2px] border-black/20 pb-1.5">
                                <Badge
                                  variant={message.role === 'user' ? 'secondary' : 'outline'}
                                  className="h-5 text-[10px]"
                                >
                                  {message.role === 'user' ? 'YOU' : 'COPILOT'}
                                </Badge>
                                <span className="font-mono text-[10px] uppercase opacity-60">
                                  {new Date().toLocaleTimeString()}
                                </span>
                              </div>
                              <div className="mt-2 whitespace-pre-wrap font-mono text-[13px] font-medium leading-relaxed">
                                {message.content}
                              </div>
                            </div>
                          </MessageContent>
                        </Message>
                      ) : (
                        <div
                          className={`flex items-center gap-2 border-[2.5px] border-black px-3 py-2 font-mono text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_black] ${
                            message.tone === 'error'
                              ? 'bg-red-500 text-white'
                              : message.tone === 'success'
                                ? 'bg-emerald-400 text-black'
                                : 'bg-black text-[#00E5FF]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {message.tone === 'info' && isGenerating ? <Spinner className="size-3" /> : null}
                            {message.tone === 'error' ? <span>⚠</span> : null}
                            {message.tone === 'success' ? <span>✓</span> : null}
                            {message.tone === 'info' ? <ZapIcon className="size-3" /> : null}
                          </div>
                          <span>{message.content}</span>
                        </div>
                      )}
                    </MessageScrollerItem>
                  ))}

                  {/* Live Generation Status */}
                  {(isGenerating || stages.length > 0) && (
                    <MessageScrollerItem messageId="live-status" scrollAnchor>
                      <LiveGenerationStatus
                        isGenerating={isGenerating}
                        stages={stages}
                        currentCode={liveCode}
                        diagnosticsCount={liveDiagnostics?.length}
                      />
                    </MessageScrollerItem>
                  )}
                </>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="border-[3px] border-black bg-[#00E5FF] text-black shadow-[3px_3px_0px_0px_black] hover:bg-[#00D4FF]" />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        ref={formRef}
        className="shrink-0 border-t-[4px] border-black bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault()
          submitPrompt()
        }}
      >
        <div className="border-[3px] border-black shadow-[4px_4px_0px_0px_black] focus-within:shadow-[6px_6px_0px_0px_black] focus-within:translate-x-[-1px] focus-within:translate-y-[-1px] transition-all">
          <textarea
            ref={textareaRef}
            rows={3}
            value={value}
            disabled={isGenerating}
            placeholder="e.g. 5V USB-C sensor board, 40×25mm, Qwiic, 2x buttons…"
            aria-label="Circuit requirements"
            className="min-h-20 w-full resize-none border-0 bg-white p-3 font-mono text-[13px] font-medium leading-relaxed outline-none placeholder:text-zinc-500 disabled:opacity-50"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              submitPrompt()
            }}
          />
          <div className="flex items-center justify-between border-t-[3px] border-black bg-zinc-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <Kbd className="border-[2px] border-black bg-white px-1.5 py-0.5 font-mono text-[10px] font-black shadow-[1px_1px_0px_0px_black]">
                ↵
              </Kbd>
              <span className="hidden font-mono text-[11px] font-black uppercase tracking-wider sm:inline">
                Run agent
              </span>
              <span className="font-mono text-[10px] text-zinc-500 sm:hidden">RUN</span>
              <Badge variant="outline" className="ml-2 hidden h-5 text-[10px] sm:inline-flex">
                SHIFT+ENTER = NEW LINE
              </Badge>
            </div>
            <Button
              type="submit"
              variant="cyan"
              size="sm"
              disabled={isGenerating || value.trim().length === 0}
              className="h-8 gap-1.5 text-[11px]"
            >
              {isGenerating ? <Spinner data-icon="inline-start" className="size-3" /> : <SendIcon className="size-3" />}
              {isGenerating ? 'WORKING' : 'GENERATE'}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {value.length}/4000 chars • Fluid Compute • Vercel
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            CYAN • BRUTAL • LIVE
          </span>
        </div>
      </form>
    </section>
  )
}
