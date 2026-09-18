'use client'

import { useRef, useState } from 'react'
import { CircuitBoardIcon } from 'lucide-react'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'
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

type PromptChatProps = {
  messages: ChatMessage[]
  isGenerating: boolean
  onSubmit: (prompt: string) => void
}

export function PromptChat({ messages, isGenerating, onSubmit }: PromptChatProps) {
  const [value, setValue] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  function submitPrompt() {
    const prompt = value.trim()
    if (!prompt || isGenerating) return
    onSubmit(prompt)
    setValue('')
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
          Engineering brief
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {messages.filter((message) => message.role === 'user').length} input
        </p>
      </header>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="justify-end gap-4 p-4">
              {messages.length === 0 ? (
                <MessageScrollerItem messageId="empty">
                  <Empty className="min-h-48 border border-dashed">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CircuitBoardIcon />
                      </EmptyMedia>
                      <EmptyTitle>Describe the board you need</EmptyTitle>
                      <EmptyDescription>
                        Fireworks writes real tscircuit source, compiles it, runs
                        connectivity and layout checks, repairs failures, and
                        unlocks fabrication files only after verification.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </MessageScrollerItem>
              ) : (
                messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === 'user'}
                  >
                    {message.role === 'user' || message.role === 'assistant' ? (
                      <Message align={message.role === 'user' ? 'end' : 'start'}>
                        <MessageContent>
                          <Bubble
                            variant={message.role === 'user' ? 'default' : 'outline'}
                            align={message.role === 'user' ? 'end' : 'start'}
                          >
                            <BubbleContent className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
                              {message.content}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    ) : (
                      <Marker
                        variant="separator"
                        className={
                          message.tone === 'error' ? 'text-destructive' : undefined
                        }
                      >
                        <MarkerIcon>
                          {message.tone === 'info' && isGenerating ? <Spinner /> : null}
                        </MarkerIcon>
                        <MarkerContent className="font-mono text-[11px] tracking-[0.12em] uppercase">
                          {message.content}
                        </MarkerContent>
                      </Marker>
                    )}
                  </MessageScrollerItem>
                ))
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        ref={formRef}
        className="shrink-0 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          submitPrompt()
        }}
      >
        <InputGroup className="h-auto">
          <InputGroupTextarea
            rows={3}
            value={value}
            disabled={isGenerating}
            placeholder="e.g. 5 V USB-C sensor board, 40 × 25 mm…"
            aria-label="Circuit requirements"
            className="min-h-20 font-mono text-[13px] leading-relaxed"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              submitPrompt()
            }}
          />
          <InputGroupAddon align="block-end" className="justify-between border-t">
            <InputGroupText>
              <Kbd>↵</Kbd>
              <span className="font-mono text-[11px] tracking-[0.12em] uppercase">
                Run agent
              </span>
            </InputGroupText>
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              disabled={isGenerating || value.trim().length === 0}
            >
              {isGenerating ? <Spinner data-icon="inline-start" /> : null}
              {isGenerating ? 'Working' : 'Generate'}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  )
}
