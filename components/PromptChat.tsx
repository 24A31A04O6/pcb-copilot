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

export function PromptChat({
  messages,
  isGenerating,
  onSubmit,
}: PromptChatProps) {
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
          Prompt
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {messages.filter((message) => message.role === 'user').length} log
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
                      <EmptyTitle>No prompts yet</EmptyTitle>
                      <EmptyDescription>
                        Describe a circuit below. Generation is still using a
                        sample blink board.
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
                    {message.role === 'user' ? (
                      <Message align="end">
                        <MessageContent>
                          <Bubble variant="default" align="end">
                            <BubbleContent className="font-mono text-[13px] leading-relaxed">
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
                          {message.tone === 'info' && isGenerating ? (
                            <Spinner />
                          ) : null}
                        </MarkerIcon>
                        <MarkerContent className="font-mono text-[11px] tracking-[0.14em] uppercase">
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
            placeholder="Describe a circuit to generate…"
            aria-label="Circuit prompt"
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
                Generate
              </span>
            </InputGroupText>
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              disabled={isGenerating || value.trim().length === 0}
            >
              {isGenerating ? <Spinner data-icon="inline-start" /> : null}
              Generate
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  )
}
