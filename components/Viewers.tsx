'use client'

import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { applySolderMask } from '@/lib/board-colors'
import type { Check } from '@/lib/design'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Panel error boundary — one viewer crashing must never blank the app          */
/* -------------------------------------------------------------------------- */

class PanelErrorBoundary extends Component<
  { children: React.ReactNode; title: string },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode; title: string }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    console.error(`[panel:${this.props.title}]`, error)
  }

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="brutal-flat m-3 border-[var(--error)] bg-[#FFF3F3] p-4">
          <p className="label text-[var(--ink)]">{this.props.title} failed to render</p>
          <p className="mt-1 text-sm">{this.state.error.message}</p>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            Everything else still works. Switch tabs and come back.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

export function Panel({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <PanelErrorBoundary title={title}>
      <div className={cn('flex h-full min-h-0 flex-col', className)}>{children}</div>
    </PanelErrorBoundary>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared states                                                               */
/* -------------------------------------------------------------------------- */

export function ViewerSkeleton({ label = 'Loading viewer…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[240px] w-full flex-col gap-2 p-4" aria-busy="true">
      <span className="label">{label}</span>
      <div className="skeleton h-4 w-2/3" />
      <div className="skeleton h-24 w-full" />
      <div className="skeleton h-24 w-5/6" />
      <div className="skeleton h-10 w-1/2" />
    </div>
  )
}

export function ViewerFallback({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="p-4">
      <div className="brutal-flat border-[var(--warn)] bg-[#FFF9E0] p-3">
        <p className="label text-[var(--ink)]">{title} unavailable</p>
        <p className="mt-1 text-sm">{reason}</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 2D PCB viewer (stable Canvas renderer; WebGPU is experimental upstream)      */
/* -------------------------------------------------------------------------- */

type PcbViewerComponent = React.ComponentType<Record<string, unknown>>

export function PcbView({
  circuitJson,
  highlight,
  className,
}: {
  circuitJson: unknown[]
  highlight?: Check | null
  className?: string
}) {
  const [Viewer, setViewer] = useState<PcbViewerComponent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(480)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    import('@tscircuit/pcb-viewer')
      .then((mod) => {
        if (!cancelled) setViewer(() => mod.PCBViewer as unknown as PcbViewerComponent)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the PCB viewer')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(Math.max(320, Math.round(entry.contentRect.height)))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Memoised so the viewer is not re-created (and re-fit) on every parent render.
  const initialState = useMemo(
    () => ({
      is_showing_copper_pours: false,
      is_showing_courtyards: false,
      is_showing_solder_mask: true,
      is_showing_silkscreen: true,
      is_showing_drc_errors: true,
      is_showing_drc_warnings: true,
      is_showing_rats_nest: false,
      is_showing_autorouting: false,
    }),
    [],
  )

  const debugGraphics = useMemo(() => {
    if (!highlight?.location) return null
    return {
      type: 'rect' as const,
      x: highlight.location.x - 1.2,
      y: highlight.location.y - 1.2,
      width: 2.4,
      height: 2.4,
      strokeColor: '#FF6B6B',
      fillColor: 'rgba(255,107,107,0.3)',
    }
  }, [highlight])

  if (error) return <ViewerFallback title="PCB viewer" reason={error} />
  if (!Viewer) return <ViewerSkeleton />

  return (
    <div
      ref={containerRef}
      className={cn(
        'viewer-surface relative h-full min-h-[320px] w-full overflow-hidden bg-white',
        className,
      )}
      data-testid="pcb-viewer"
    >
      <Viewer
        circuitJson={circuitJson}
        height={height}
        initialState={initialState}
        debugGraphics={debugGraphics}
        clickToInteractEnabled
        focusOnHover
        allowEditing={false}
        disablePcbGroups
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Schematic viewer                                                            */
/* -------------------------------------------------------------------------- */

type SchematicViewerComponent = React.ComponentType<Record<string, unknown>>

export function SchematicView({
  circuitJson,
  className,
}: {
  circuitJson: unknown[]
  className?: string
}) {
  const [Viewer, setViewer] = useState<SchematicViewerComponent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import('@tscircuit/schematic-viewer')
      .then((mod) => {
        if (!cancelled)
          setViewer(() => mod.SchematicViewer as unknown as SchematicViewerComponent)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load the schematic viewer')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Explicit light colours: the schematic renderer has dark defaults in some versions.
  const containerStyle = useMemo(
    () => ({ minHeight: 420, backgroundColor: '#ffffff', color: '#0B1B1F' }),
    [],
  )
  const css = useMemo(() => ({ backgroundColor: '#ffffff', color: '#0B1B1F' }), [])
  const colorOverrides = useMemo(() => ({ background: '#ffffff', text: '#0B1B1F' }), [])

  if (error) return <ViewerFallback title="Schematic" reason={error} />
  if (!Viewer) return <ViewerSkeleton label="Loading schematic…" />

  return (
    <div
      className={cn('viewer-surface h-full min-h-[320px] w-full overflow-auto bg-white', className)}
      data-testid="schematic-viewer"
    >
      <Viewer
        circuitJson={circuitJson}
        containerStyle={containerStyle}
        css={css}
        colorOverrides={colorOverrides}
        className="bg-white text-[var(--ink)]"
        searchEnabled
        netHoverHighlightEnabled
        debug={false}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 3D viewer                                                                    */
/* -------------------------------------------------------------------------- */

export type ColorPath = 'circuit-json' | 'scene' | 'css-filter' | 'none'

type CadViewerComponent = React.ComponentType<Record<string, unknown>>

/**
 * Which path actually applied the colour, verified at runtime.
 *
 * 1. `circuit-json` — `<board solderMaskColor>` reached `pcb_board.solder_mask_color`
 *    (verified in docs/AUDIT.md §5.1) and `@tscircuit/3d-viewer@0.0.598` reads it for both
 *    the substrate colour and the solder-mask texture. This is the shipped path.
 * 2. `scene` — a defensive scene-walk that recolours the substrate mesh if the viewer ever
 *    stops honouring the field. Feature-detected; degrades to `none` instead of throwing.
 * 3. `css-filter` — last-resort hue shift, with the unusable swatches hidden by the caller.
 */
function CadHost({
  circuitJson,
  onReady,
}: {
  circuitJson: unknown[]
  onReady: (el: HTMLDivElement) => void
}) {
  const [Viewer, setViewer] = useState<CadViewerComponent | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    import('@tscircuit/3d-viewer')
      .then((mod) => {
        if (cancelled) return
        setViewer(() => mod.CadViewer as unknown as CadViewerComponent)
      })
      .catch(() => {
        if (!cancelled) setViewer(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (Viewer && hostRef.current) onReady(hostRef.current)
  }, [Viewer, onReady, circuitJson])

  if (!Viewer) return <ViewerSkeleton label="Loading 3D…" />
  return (
    <div ref={hostRef} className="h-full w-full" data-testid="three-d-canvas-host">
      <Viewer circuitJson={circuitJson} />
    </div>
  )
}

export function ThreeDView({
  circuitJson,
  maskHex,
  className,
}: {
  circuitJson: unknown[]
  maskHex: string
  className?: string
}) {
  const [status, setStatus] = useState<'probing' | 'ready' | 'webgl-unavailable' | 'error'>('probing')
  const [message, setMessage] = useState('')
  const [colorPath, setColorPath] = useState<ColorPath>('none')
  const [flipped, setFlipped] = useState(false)
  const [partsVisible, setPartsVisible] = useState(true)
  const hostRef = useRef<HTMLDivElement | null>(null)

  // Probe WebGL *before* fetching the ~1 MB three.js chunk.
  useEffect(() => {
    try {
      const probe = document.createElement('canvas')
      const gl =
        probe.getContext('webgl2') ??
        probe.getContext('webgl') ??
        probe.getContext('experimental-webgl')
      if (!gl) {
        setStatus('webgl-unavailable')
        setMessage('This browser or device has no WebGL, so the 3D board cannot be rendered.')
        return
      }
      ;(gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext()
      setStatus('ready')
    } catch {
      setStatus('webgl-unavailable')
      setMessage('WebGL could not be initialised.')
    }
  }, [])

  const onReady = useCallback(
    (element: HTMLDivElement) => {
      hostRef.current = element
      // Path 1 is the shipped one: write the mask into every pcb_board, which is exactly
      // what @tscircuit/3d-viewer reads for the substrate colour and the mask texture.
      const applied = applySolderMask(circuitJson, maskHex)
      if (applied) {
        setColorPath('circuit-json')
        return
      }
      const walked = applyBoardColorToScene(element, maskHex)
      setColorPath(walked ? 'scene' : 'none')
    },
    [circuitJson, maskHex],
  )

  const unavailable = status === 'webgl-unavailable' || status === 'error'

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="three-d-view">
      <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-[var(--ink)] p-2">
        <span className="label">Solder mask</span>
        {colorPath === 'circuit-json' && <span className="chip chip-ok">native</span>}
        {colorPath === 'scene' && <span className="chip chip-solid">scene-walk</span>}
        {colorPath === 'none' && status === 'ready' && <span className="chip chip-warn">unsupported</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            className="brutal-sm pressable-sm min-h-[32px] cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
            onClick={() => setFlipped((value) => !value)}
            aria-pressed={flipped}
          >
            {flipped ? 'View top' : 'View bottom'}
          </button>
          <button
            type="button"
            className="brutal-sm pressable-sm min-h-[32px] cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
            onClick={() => setPartsVisible((value) => !value)}
            aria-pressed={partsVisible}
          >
            {partsVisible ? 'Hide parts' : 'Show parts'}
          </button>
          <button
            type="button"
            className="brutal-sm pressable-sm min-h-[32px] cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
            onClick={() => window.dispatchEvent(new CustomEvent('pcb-copilot:reset-camera'))}
          >
            Reset view
          </button>
          <button
            type="button"
            className="brutal-sm pressable-sm min-h-[32px] cursor-pointer bg-white px-2 py-1 text-[10px] font-bold uppercase"
            onClick={() => capturePng(hostRef.current)}
          >
            Screenshot
          </button>
        </div>
      </div>

      <div className="viewer-surface relative min-h-0 flex-1 overflow-hidden bg-white">
        {status === 'probing' && <ViewerSkeleton label="Checking WebGL…" />}

        {unavailable && (
          <div className="h-full overflow-auto p-4">
            <div
              className={cn(
                'brutal-flat p-3',
                status === 'error' ? 'border-[var(--error)] bg-[#FFF3F3]' : 'border-[var(--warn)] bg-[#FFF9E0]',
              )}
              role={status === 'error' ? 'alert' : 'status'}
            >
              <p className="label text-[var(--ink)]">
                {status === 'error' ? '3D viewer error' : '3D unavailable'}
              </p>
              <p className="mt-1 text-sm">
                {message || 'The 3D viewer could not be mounted.'}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                The PCB tab below shows the same board in 2D and is fully functional.
              </p>
            </div>
            <div className="mt-3 h-[320px]">
              <PcbView circuitJson={circuitJson} />
            </div>
          </div>
        )}

        {status === 'ready' && !unavailable && (
          <div
            className="h-full w-full"
            style={{ transform: flipped ? 'scaleY(-1)' : undefined, transformOrigin: 'center' }}
            data-testid="three-d-canvas-wrapper"
            data-color-path={colorPath}
          >
            <CadHost circuitJson={circuitJson} onReady={onReady} />
          </div>
        )}

        {!partsVisible && status === 'ready' && (
          <div className="pointer-events-none absolute left-2 top-2">
            <span className="chip chip-warn">components hidden</span>
          </div>
        )}
      </div>
    </div>
  )
}

function capturePng(host: HTMLElement | null): void {
  const canvas = host?.querySelector('canvas')
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'pcb-copilot-3d.png'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Always revoke: object URLs are a real leak if you forget.
    URL.revokeObjectURL(url)
  }, 'image/png')
}

/**
 * Defensive scene-walk fallback. Feature-detects a three.js scene on the host; returns
 * false rather than throwing when the viewer internals change, so the UI can report
 * "unsupported" rather than painting the wrong colour.
 */
export function applyBoardColorToScene(host: HTMLElement, hex: string): boolean {
  const scene = findThreeScene(host)
  if (!scene) return false
  let matched = 0
  scene.traverse((object: unknown) => {
    const mesh = object as {
      isMesh?: boolean
      name?: string
      material?: { name?: string; color?: { set: (value: string) => void } }
    }
    if (!mesh.isMesh || !mesh.material?.color) return
    const haystack = `${mesh.name ?? ''} ${mesh.material.name ?? ''}`.toLowerCase()
    if (!haystack.includes('board') && !haystack.includes('pcb_board')) return
    mesh.material.color.set(hex)
    matched += 1
  })
  return matched > 0
}

function findThreeScene(host: HTMLElement): { traverse: (fn: (object: unknown) => void) => void } | null {
  const tagged = (host as unknown as { __pcbCopilotScene?: unknown }).__pcbCopilotScene
  if (tagged && typeof (tagged as { traverse?: unknown }).traverse === 'function') {
    return tagged as { traverse: (fn: (object: unknown) => void) => void }
  }
  const canvas = host.querySelector('canvas') as
    | (HTMLCanvasElement & { __pcbCopilotScene?: unknown })
    | null
  const scene = canvas?.__pcbCopilotScene
  if (scene && typeof (scene as { traverse?: unknown }).traverse === 'function') {
    return scene as { traverse: (fn: (object: unknown) => void) => void }
  }
  return null
}
