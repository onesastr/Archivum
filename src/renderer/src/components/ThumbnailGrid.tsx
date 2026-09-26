import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { FileEntry, FileMetadata } from '@shared/contract'
import { formatBytes, formatDate } from '@shared/formats'
import { cn } from '@/lib/utils'
import { useElementSize } from '@/hooks/useElementSize'

const api = window.archivum
const GAP = 8
const LABEL_HEIGHT = 38
const MIN_TILE = 132
const MAX_TILE = 280
const OVERSCAN_ROWS = 3

export interface GridProps {
  files: FileEntry[]
  metadata: Record<string, FileMetadata>
  selectedPath: string | null
  tileSize: number
  loading: boolean
  onSelect: (file: FileEntry) => void
  onActivate: (file: FileEntry) => void
  onVisible: (files: FileEntry[]) => void
}

/**
 * Windowed grid: a folder with 50k files must not create 50k DOM nodes. Only the
 * visible rows plus a small overscan are mounted. `<img>` loading is left to the
 * browser, which naturally throttles how many decode requests reach the
 * main-process render queue at once.
 */
export function ThumbnailGrid({
  files,
  metadata,
  selectedPath,
  tileSize,
  loading,
  onSelect,
  onActivate,
  onVisible
}: GridProps) {
  const { ref: containerRef, width, height } = useElementSize<HTMLDivElement>()
  const [scrollTop, setScrollTop] = useState(0)

  const tile = clamp(tileSize > 0 ? tileSize : 200, MIN_TILE, MAX_TILE)
  const columns = Math.max(1, Math.floor((width + GAP) / (tile + GAP)))
  const rowHeight = tile + LABEL_HEIGHT + GAP
  const rowCount = Math.ceil(files.length / columns)
  const totalHeight = rowCount * rowHeight

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)
  const lastRow = Math.min(rowCount, firstRow + Math.ceil(height / rowHeight) + OVERSCAN_ROWS * 2)
  const start = firstRow * columns
  const end = Math.min(files.length, lastRow * columns)

  const windowed = useMemo(() => files.slice(start, end), [end, files, start])

  useEffect(() => {
    if (end > start) onVisible(files.slice(start, end))
  }, [end, files, onVisible, start])

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [containerRef, files])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (files.length === 0) return
      const index = files.findIndex((file) => file.path === selectedPath)

      let next: number
      switch (event.key) {
        case 'ArrowRight':
          next = index < 0 ? 0 : index + 1
          break
        case 'ArrowLeft':
          next = index <= 0 ? 0 : index - 1
          break
        case 'ArrowDown':
          next = index < 0 ? 0 : index + columns
          break
        case 'ArrowUp':
          next = index < columns ? 0 : index - columns
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = files.length - 1
          break
        case 'Enter': {
          const current = index >= 0 ? files[index] : undefined
          if (current === undefined) return
          event.preventDefault()
          onActivate(current)
          return
        }
        default:
          return
      }

      event.preventDefault()
      const target = files[clamp(next, 0, files.length - 1)]
      if (target) onSelect(target)
    },
    [columns, files, onActivate, onSelect, selectedPath]
  )

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          {loading ? 'Reading folder…' : 'No images in this folder yet.'}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="scrollbar-thin h-full overflow-y-auto overflow-x-hidden outline-none"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="grid"
      aria-label="Image grid"
      data-testid="thumbnail-grid"
    >
      <div className="relative w-full" style={{ height: totalHeight }}>
        <div
          className="absolute inset-x-0 grid"
          style={{
            top: firstRow * rowHeight,
            gridTemplateColumns: `repeat(${columns}, ${tile}px)`,
            gap: GAP,
            paddingLeft: GAP,
            paddingRight: GAP
          }}
        >
          {windowed.map((file) => (
            <Tile
              key={file.path}
              file={file}
              meta={metadata[file.path]}
              size={tile}
              selected={file.path === selectedPath}
              onSelect={onSelect}
              onActivate={onActivate}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Tile({
  file,
  meta,
  size,
  selected,
  onSelect,
  onActivate
}: {
  file: FileEntry
  meta: FileMetadata | undefined
  size: number
  selected: boolean
  onSelect: (file: FileEntry) => void
  onActivate: (file: FileEntry) => void
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const imageSize = size - 2

  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      onDoubleClick={() => onActivate(file)}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors',
        'hover:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border'
      )}
    >
      <div
        className="checkerboard relative flex items-center justify-center overflow-hidden bg-muted"
        style={{ height: imageSize }}
      >
        {state !== 'error' ? (
          <img
            src={api.assets.url('thumb', file.path, { size: imageSize })}
            alt={file.name}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setState('ready')}
            onError={() => setState('error')}
            className={cn(
              'size-full object-contain transition-opacity duration-150',
              state === 'ready' ? 'opacity-100' : 'opacity-0'
            )}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/60">
            <ImageOff className="size-4" />
            <span className="text-[10px] uppercase">{file.ext}</span>
          </div>
        )}

        {file.kind === 'raw' ? (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white/90 uppercase">
            {file.ext}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-[11px] leading-tight font-medium" title={file.name}>
          {file.name}
        </span>
        <span className="truncate text-[10px] leading-tight text-muted-foreground">
          {meta?.captureAt != null
            ? formatDate(meta.captureAt)
            : (meta?.camera ?? formatBytes(file.sizeBytes))}
        </span>
      </div>
    </button>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
