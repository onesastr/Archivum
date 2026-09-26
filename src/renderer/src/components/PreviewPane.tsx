import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, AlertTriangle } from 'lucide-react'
import type { FileEntry, FileMetadata, PreviewPayload } from '@shared/contract'
import { formatBytes, formatDate, formatDimensions } from '@shared/formats'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const FIT = 'fit'
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8]

export function PreviewPane({
  file,
  previewUrl,
  previewReason,
  metadata
}: {
  file: FileEntry | null
  previewUrl: string | null
  previewReason: string | null
  metadata: Record<string, FileMetadata>
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState<number | 'fit'>(FIT)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setScale(FIT)
    setPan({ x: 0, y: 0 })
    setNatural(null)
  }, [previewUrl])

  useEffect(() => {
    if (dragging) return
    const viewport = viewportRef.current
    if (viewport === null || scale !== FIT || natural === null) return
    const ratio = Math.min(
      viewport.clientWidth / natural.width,
      viewport.clientHeight / natural.height,
      1
    )
    setScale(ratio > 0 ? ratio : 1)
  }, [dragging, natural, scale])

  const changeScale = useCallback((delta: number) => {
    setScale((current) => {
      const base = current === FIT ? 1 : current
      const next = clampStep(base + delta)
      return next
    })
    setPan({ x: 0, y: 0 })
  }, [])

  const onWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    changeScale(event.deltaY > 0 ? -0.25 : 0.25)
  }, [changeScale])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || scale === FIT) return
    dragRef.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [pan.x, pan.y, scale])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current
    if (drag === null) return
    setPan({ x: drag.originX + (event.clientX - drag.x), y: drag.originY + (event.clientY - drag.y) })
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    dragRef.current = null
    setDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  if (file === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Select an image to preview it.
      </div>
    )
  }

  const meta = metadata[file.path]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={viewportRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'checkerboard relative min-h-0 flex-1 overflow-hidden bg-muted/40',
          dragging ? 'cursor-grabbing' : scale !== FIT ? 'cursor-grab' : 'cursor-default'
        )}
      >
        {previewUrl !== null ? (
          <img
            key={previewUrl}
            src={previewUrl}
            alt={file.name}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget
              setNatural({ width: image.naturalWidth, height: image.naturalHeight })
            }}
            className="absolute top-1/2 left-1/2 max-w-none select-none"
            style={{
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
              transformOrigin: 'center center'
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            {previewReason === 'loading' || previewReason === null ? (
              <span className="text-sm text-muted-foreground">Rendering preview…</span>
            ) : (
              <>
                <AlertTriangle className="size-5 text-muted-foreground/60" />
                <span className="max-w-xs text-xs text-muted-foreground">{previewReason}</span>
              </>
            )}
          </div>
        )}

        <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 backdrop-blur">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => changeScale(-0.25)}>
                <Minus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <span className="min-w-11 text-center text-[11px] tabular-nums text-muted-foreground">
            {scale === FIT ? 'Fit' : `${Math.round(scale * 100)}%`}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => changeScale(0.25)}>
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setScale(FIT)
                  setPan({ x: 0, y: 0 })
                }}
              >
                <Maximize2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to window</TooltipContent>
          </Tooltip>
        </div>

        {scale !== FIT ? (
          <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
            Drag to pan · ⌘/Ctrl + scroll to zoom
          </p>
        ) : null}
      </div>

      <MetadataPanel file={file} meta={meta} />
    </div>
  )
}

function clampStep(value: number): number {
  let closest = ZOOM_STEPS[0]
  let distance = Number.POSITIVE_INFINITY
  for (const step of ZOOM_STEPS) {
    const delta = Math.abs(step - value)
    if (delta < distance) {
      distance = delta
      closest = step
    }
  }
  return closest
}

function MetadataPanel({ file, meta }: { file: FileEntry; meta: FileMetadata | undefined }) {
  const rows: Array<[string, string]> = []
  const push = (label: string, value: string | null | undefined): void => {
    if (value != null && value.length > 0) rows.push([label, value])
  }

  push('File', file.name)
  push('Type', `${file.kind === 'raw' ? 'RAW' : 'Image'} (${file.ext.toUpperCase()})`)
  push('Size', formatBytes(file.sizeBytes))
  push('Dimensions', formatDimensions(meta?.width ?? file.width, meta?.height ?? file.height))
  push('Captured', meta?.captureAt != null ? formatDate(meta.captureAt) : null)
  push('Camera', meta?.camera)
  push('Lens', meta?.lens)
  push(
    'Exposure',
    meta?.aperture != null || meta?.shutter != null || meta?.iso != null
      ? [
          meta?.aperture != null ? `f/${meta.aperture}` : null,
          meta?.shutter != null ? shutterText(meta.shutter) : null,
          meta?.iso != null ? `ISO ${meta.iso}` : null
        ]
          .filter(Boolean)
          .join('  ·  ')
      : null
  )
  push('Focal length', meta?.focalLength != null ? `${Math.round(meta.focalLength)}mm` : null)
  push('Colour profile', meta?.icc?.name)
  push('Colour space', meta?.icc?.colorSpace)
  push('GPS', meta?.gps ? formatGps(meta.gps) : null)
  push('Modified', formatDate(file.mtimeMs))

  if (meta?.state === 'pending') {
    push('Status', 'reading metadata…')
  }

  return (
    <div className="max-h-56 shrink-0 overflow-y-auto border-t border-border bg-card/40 scrollbar-thin">
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-border/40 last:border-0">
              <th
                scope="row"
                className="w-28 shrink-0 px-3 py-1 text-left font-normal text-muted-foreground"
              >
                {label}
              </th>
              <td className="px-3 py-1 break-words text-foreground/90">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function shutterText(seconds: number): string {
  return seconds >= 1 ? `${seconds.toFixed(1)}s` : `1/${Math.round(1 / seconds)}`
}

function formatGps(gps: { latitude: number; longitude: number }): string {
  const lat = `${Math.abs(gps.latitude).toFixed(4)}° ${gps.latitude >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(gps.longitude).toFixed(4)}° ${gps.longitude >= 0 ? 'E' : 'W'}`
  return `${lat}, ${lon}`
}

export type { PreviewPayload }
