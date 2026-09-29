'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The command palette.
 *
 * Every action in the app is reachable from here, because every action is also reachable
 * from the keyboard. That is the point: a design tool spends most of its time in a loop of
 * "change a thing, regenerate, look at the board", and reaching that loop through a mouse
 * is what makes a tool feel slow.
 *
 * Two decisions worth stating:
 *
 *   - The palette is a real `role="dialog"` with a focus trap and a restore, not a div that
 *     happens to look modal. Screen-reader users get the same thing keyboard users do.
 *   - Nothing here is a global singleton. The parent owns the command list, so a command
 *     that is not available right now (download a design that does not exist) is not
 *     offered rather than offered and disabled.
 */

export type Command = {
  id: string
  label: string
  /** Grouped in the list. Short, human headings. */
  group: string
  /** Shown on the right, e.g. "G". */
  hint?: string
  run: () => void
  disabled?: boolean
}

type Props = {
  commands: Command[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ commands, open, onOpenChange }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  const available = useMemo(() => commands.filter((command) => !command.disabled), [commands])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return available
    // A plain substring match, then a subsequence match so "gbr" finds "Gerber ZIP".
    // Ranking by where the match lands keeps "generate design" above "design output".
    const scored: Array<{ command: Command; score: number }> = []
    for (const command of available) {
      const haystack = `${command.group} ${command.label}`.toLowerCase()
      const at = haystack.indexOf(needle)
      if (at !== -1) {
        scored.push({ command, score: at })
        continue
      }
      let cursor = 0
      for (const char of needle) {
        cursor = haystack.indexOf(char, cursor)
        if (cursor === -1) break
        cursor += 1
      }
      if (cursor !== -1) scored.push({ command, score: 1000 })
    }
    return scored.sort((a, b) => a.score - b.score).map((entry) => entry.command)
  }, [available, query])

  // Focus in on open, and put the caret back where it was on close.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActive(0)
    // The input has to exist before it can take focus, hence the frame.
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) {
      restoreRef.current?.focus()
      restoreRef.current = null
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  const choose = useCallback(
    (command: Command | undefined) => {
      if (!command) return
      onOpenChange(false)
      // After the dialog unmounts, so focus lands on the thing the command changes.
      requestAnimationFrame(() => command.run())
    },
    [onOpenChange],
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(filtered[active])
      return
    }
    if (event.key === 'Tab') {
      // A real focus trap: the palette is a dialog, and Tab must not walk out of it.
      event.preventDefault()
    }
  }

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, filtered])

  if (!open) return null

  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="brutal w-full max-w-lg bg-white"
        data-testid="command-palette"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={filtered[active] ? `command-${filtered[active].id}` : undefined}
          aria-label="Search commands"
          placeholder="Type a command, or press ? for everything"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full border-b-[3px] border-[var(--ink)] bg-white px-3 py-2 text-sm font-bold outline-none"
          data-testid="command-input"
        />
        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          ref={listRef}
          className="max-h-[50vh] overflow-auto"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-sm" data-testid="command-empty">
              Nothing matches “{query}”.
            </li>
          )}
          {filtered.map((command, index) => {
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <li key={command.id}>
                {showGroup && (
                  <p className="bg-[var(--paper)] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    {command.group}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  id={`command-${command.id}`}
                  aria-selected={index === active}
                  data-active={index === active}
                  data-testid={`command-${command.id}`}
                  // `onMouseDown` rather than `onClick`: a click fires after the input
                  // blurs, and blurring the input is what closes the palette.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(command)
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={
                    index === active
                      ? 'flex w-full items-center gap-2 bg-[var(--accent)] px-3 py-2 text-left text-sm font-bold'
                      : 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm'
                  }
                >
                  <span className="flex-1 truncate">{command.label}</span>
                  {command.hint && (
                    <kbd className="brutal-sm bg-white px-1.5 py-0.5 text-[10px] font-bold">{command.hint}</kbd>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/**
 * Global shortcuts.
 *
 * Ignores anything typed into a field, including a textarea and anything with
 * `contenteditable`, so `?` in a brief stays a question mark. Cmd/Ctrl-K is the one
 * combination that is intercepted everywhere, because it is the convention and because a
 * user reaching for it is not typing.
 */
export function useCommandShortcuts(
  onToggle: () => void,
  onHelp: () => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          if (!(event.metaKey || event.ctrlKey)) return
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onToggle()
        return
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === '?') {
        event.preventDefault()
        onHelp()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onToggle, onHelp])
}
