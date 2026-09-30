'use client'

import { useMemo } from 'react'

import {
  mapToRects,
  spriteFor,
  ZERO_PALETTE,
  ZERO_STATE_LABEL,
  type ZeroState,
} from '@/components/zero-sprite'
import { cn } from '@/lib/utils'

/**
 * `<Zero state="…" />`
 *
 * A single mascot whose pose is driven by the pipeline. Animation is CSS keyframes with
 * `steps()` so the sprite never gets sub-pixel interpolated — it stays pixel-crisp.
 * Under `prefers-reduced-motion` the global rule in globals.css freezes every animation,
 * leaving a complete, readable static pose.
 */

type ZeroProps = {
  state: ZeroState
  size?: number
  className?: string
  /** Announce the state to assistive tech. */
  label?: string
}

/** Turn a set of 24x24 grid cells into one crisp-edged `<path>` of 1x1 squares. */
function pixelPath(cells: Array<[number, number]>): string {
  return cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')
}

export function Zero({ state, size = 96, className, label }: ZeroProps) {
  const rects = useMemo(() => mapToRects(spriteFor(state), ZERO_PALETTE), [state])
  const blink = useMemo(() => {
    // Blink every ~4s: a single-frame eyelid.
    const closed: Array<[number, number]> = [
      [9, 11],
      [10, 11],
      [11, 11],
      [13, 11],
      [14, 11],
      [15, 11],
    ]
    return pixelPath(closed)
  }, [])

  const confetti = useMemo(
    () =>
      (
        [
          [3, 1, '#22D3EE'],
          [7, 0, '#FFE14D'],
          [11, 2, '#FF6B6B'],
          [15, 0, '#5EEAD4'],
          [19, 2, '#22D3EE'],
          [5, 3, '#FF6B6B'],
          [17, 4, '#FFE14D'],
        ] as Array<[number, number, string]>
      ).map(([x, y, fill], index) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={fill}
          className="confetti-pixel"
          style={{ animationDelay: `${index * 70}ms` }}
        />
      )),
    [],
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? ZERO_STATE_LABEL[state]}
      data-testid="zero-mascot"
      data-state={state}
      className={cn('zero-sprite select-none', className)}
    >
      <g className={cn('zero-root', `zero-${state}`)}>
        {/* raised left arm: waves in idle/success, points at the work otherwise */}
        <g className="zero-arm-left">
          <rect x={2} y={2} width={4} height={4} fill={ZERO_PALETTE.ink} />
          <rect x={3} y={3} width={2} height={2} fill={ZERO_PALETTE.body} />
          <rect x={5} y={5} width={2} height={2} fill={ZERO_PALETTE.ink} />
          <rect x={6} y={7} width={2} height={1} fill={ZERO_PALETTE.ink} />
        </g>

        {/* hanging right arm with a curled hand */}
        <g className="zero-arm-right">
          <rect x={18} y={9} width={2} height={6} fill={ZERO_PALETTE.ink} />
          <rect x={19} y={10} width={1} height={4} fill={ZERO_PALETTE.body} />
          <rect x={18} y={15} width={3} height={3} fill={ZERO_PALETTE.ink} />
          <rect x={19} y={16} width={1} height={1} fill={ZERO_PALETTE.body} />
        </g>

        {/* floor shadow */}
        <rect x={5} y={22} width={15} height={1} fill={ZERO_PALETTE.shadow} />

        {/* body */}
        <g className="zero-body">
          {rects
            .filter((rect) => rect.y >= 6 && rect.y <= 17 && rect.x >= 7 && rect.x <= 17)
            .map((rect) => (
              <rect
                key={`b-${rect.x}-${rect.y}`}
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                fill={rect.fill}
              />
            ))}
        </g>

        {/* state props ------------------------------------------------------- */}
        {state === 'checking' && (
          <g className="zero-prop zero-prop-magnifier">
            <rect x={16} y={8} width={5} height={1} fill={ZERO_PALETTE.ink} />
            <rect x={16} y={8} width={1} height={5} fill={ZERO_PALETTE.ink} />
            <rect x={20} y={8} width={1} height={5} fill={ZERO_PALETTE.ink} />
            <rect x={16} y={12} width={5} height={1} fill={ZERO_PALETTE.ink} />
            <rect x={21} y={13} width={2} height={2} fill={ZERO_PALETTE.ink} />
            <rect x={17} y={9} width={3} height={3} fill="#CFFAFE" />
          </g>
        )}

        {state === 'compiling' && (
          <g className="zero-prop zero-prop-gear">
            <rect x={10} y={1} width={4} height={1} fill={ZERO_PALETTE.warn} />
            <rect x={9} y={2} width={6} height={1} fill={ZERO_PALETTE.warn} />
            <rect x={8} y={3} width={8} height={1} fill={ZERO_PALETTE.ink} />
            <rect x={9} y={4} width={6} height={1} fill={ZERO_PALETTE.ink} />
            <rect x={10} y={5} width={4} height={1} fill={ZERO_PALETTE.ink} />
          </g>
        )}

        {state === 'repairing' && (
          <g className="zero-prop zero-prop-wrench">
            <rect x={20} y={2} width={3} height={1} fill={ZERO_PALETTE.ink} />
            <rect x={20} y={2} width={1} height={3} fill={ZERO_PALETTE.ink} />
            <rect x={19} y={5} width={2} height={4} fill={ZERO_PALETTE.ink} />
            <rect x={18} y={9} width={2} height={2} fill={ZERO_PALETTE.ink} />
            {/* sweat drop */}
            <rect x={7} y={4} width={1} height={1} fill={ZERO_PALETTE.accent} />
            <rect x={6} y={5} width={3} height={2} fill={ZERO_PALETTE.accent} />
            <rect x={7} y={7} width={1} height={1} fill={ZERO_PALETTE.accent} />
          </g>
        )}

        {state === 'success' && (
          <g className="zero-prop zero-prop-confetti" data-testid="zero-confetti">
            {confetti}
          </g>
        )}

        {state === 'error' && (
          <g className="zero-prop zero-prop-sweat">
            <rect x={6} y={5} width={1} height={1} fill={ZERO_PALETTE.error} />
            <rect x={5} y={6} width={3} height={2} fill={ZERO_PALETTE.error} />
            <rect x={6} y={8} width={1} height={1} fill={ZERO_PALETTE.error} />
          </g>
        )}

        {(state === 'locked' || state === 'unlocked') && (
          <g className="zero-prop zero-prop-package" data-testid="zero-package">
            <rect x={19} y={3} width={4} height={4} fill={ZERO_PALETTE.accent} />
            <rect x={19} y={3} width={4} height={1} fill={ZERO_PALETTE.ink} />
            <rect x={20} y={4} width={1} height={3} fill={ZERO_PALETTE.ink} />
          </g>
        )}

        {/* eyelid, used by the blink keyframes */}
        <path d={blink} fill={ZERO_PALETTE.body} className="zero-blink" />
      </g>
    </svg>
  )
}

export default Zero
