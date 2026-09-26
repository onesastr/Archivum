import { useCallback, useMemo } from 'react'
import {
  ChevronRight,
  FolderPlus,
  Loader2,
  RefreshCw,
  Scan,
  SlidersHorizontal
} from 'lucide-react'
import type { FileEntry } from '@shared/contract'
import { formatBytes, formatCount } from '@shared/formats'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { TitleBar } from '@/components/TitleBar'
import { FolderTree } from '@/components/FolderTree'
import { ThumbnailGrid } from '@/components/ThumbnailGrid'
import { PreviewPane } from '@/components/PreviewPane'
import { useLibrary } from '@/hooks/useLibrary'
import { useElementSize } from '@/hooks/useElementSize'

const api = window.archivum

export default function App() {
  const library = useLibrary()
  const { ref: splitRef, width } = useElementSize<HTMLDivElement>()

  const showPreview = width >= 1100
  const showMetadataPanel = width >= 820

  const { title, subtitle } = useMemo(() => {
    const segments = (library.selectedFolder ?? '').split('/').filter(Boolean)
    if (segments.length === 0) return { title: '', subtitle: null }
    return {
      title: segments[segments.length - 2] ?? segments[0] ?? '/',
      subtitle: segments[segments.length - 1] ?? '/'
    }
  }, [library.selectedFolder])

  const onVisible = useCallback(
    (files: FileEntry[]) => {
      library.refreshMetadata(files.map((file) => file.path))
    },
    [library]
  )

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar title={title} subtitle={subtitle} />

      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void library.addFolder()}>
          <FolderPlus className="size-3.5" />
          Add folder
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={library.selectedFolder === null || library.scan?.state === 'running'}
          onClick={() => void library.rescan()}
        >
          {library.scan?.state === 'running' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Scan className="size-3.5" />
          )}
          Scan
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <SortMenu
          value={library.sortBy}
          onChange={library.setSortBy}
          direction={library.settings.sortDirection}
          onToggleDirection={() =>
            void library.patchSettings({
              sortDirection: library.settings.sortDirection === 'asc' ? 'desc' : 'asc'
            })
          }
        />

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() =>
            void library.patchSettings({ thumbnailSize: library.settings.thumbnailSize + 40 })
          }
          aria-label="Larger thumbnails"
        >
          <SlidersHorizontal className="size-3.5" />
        </Button>
      </div>

      <div ref={splitRef} className="flex min-h-0 flex-1">
        {showMetadataPanel ? (
          <aside className="w-64 shrink-0 border-r border-border">
            <FolderTree
              tree={library.tree}
              expanded={library.expanded}
              selectedFolder={library.selectedFolder}
              onSelect={(path) => void library.selectFolder(path)}
              onToggle={(path) => void library.toggleExpanded(path)}
            />
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col">
          <FolderBreadcrumb
            path={library.selectedFolder}
            onNavigate={(path) => void library.selectFolder(path)}
          />
          <div className="min-h-0 flex-1">
            <ThumbnailGrid
              files={library.files}
              metadata={library.metadata}
              selectedPath={library.selectedFile?.path ?? null}
              tileSize={library.settings.thumbnailSize}
              loading={library.loading}
              onSelect={library.selectFile}
              onActivate={(file) => void api.shell.openPath(file.path)}
              onVisible={onVisible}
            />
          </div>
        </main>

        {showPreview ? (
          <aside className="w-[420px] shrink-0 border-l border-border">
            <PreviewPane
              file={library.selectedFile}
              previewUrl={library.previewUrl}
              previewReason={library.previewReason}
              metadata={library.metadata}
            />
          </aside>
        ) : null}
      </div>

      <StatusBar library={library} />
    </div>
  )
}

function FolderBreadcrumb({
  path,
  onNavigate
}: {
  path: string | null
  onNavigate: (path: string) => void
}) {
  if (path === null) return <div className="h-8 border-b border-border" />

  const segments = path.split('/').filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = [
    { label: '/', path: '/' },
    ...segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join('/')}`
    }))
  ]

  return (
    <nav className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-3 scrollbar-thin">
      {crumbs.map((crumb, index) => (
        <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
          {index > 0 ? <ChevronRight className="size-3 text-muted-foreground/50" /> : null}
          <button
            type="button"
            onClick={() => onNavigate(crumb.path)}
            className="max-w-40 truncate rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

function SortMenu({
  value,
  onChange,
  direction,
  onToggleDirection
}: {
  value: 'name' | 'date' | 'size' | 'kind'
  onChange: (value: 'name' | 'date' | 'size' | 'kind') => void
  direction: 'asc' | 'desc'
  onToggleDirection: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
          <RefreshCw className="size-3" />
          Sort: {value}
          <span className="text-muted-foreground">{direction === 'asc' ? '↑' : '↓'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange('name')}>Name</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange('date')}>Capture date</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange('size')}>File size</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange('kind')}>File type</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onToggleDirection}>
          Reverse order ({direction === 'asc' ? 'ascending' : 'descending'})
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusBar({ library }: { library: ReturnType<typeof useLibrary> }) {
  const scan = library.scan
  const totalBytes = useMemo(
    () => library.files.reduce((total, file) => total + file.sizeBytes, 0),
    [library.files]
  )
  const subfolderCount = library.listing?.folders.length ?? 0

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-card/50 px-3 text-[11px] text-muted-foreground">
      {scan?.state === 'running' ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          <span className="truncate">
            Scanning {formatCount(scan.foldersDone)} folders ·{' '}
            {formatCount(scan.filesIndexed)} files
          </span>
          {scan.currentPath ? (
            <span className="truncate opacity-60">{scan.currentPath}</span>
          ) : null}
        </>
      ) : (
        <>
          <span>
            {formatCount(library.files.length)} items
            {library.files.length > 0 ? ` · ${formatBytes(totalBytes)}` : ''}
          </span>
          {subfolderCount > 0 ? <span>· {subfolderCount} subfolders</span> : null}
          {library.listing?.fromCache === false ? <span>· refreshed from disk</span> : null}
        </>
      )}
      <div className="flex-1" />
      {library.selectedFile ? (
        <span className="truncate">{library.selectedFile.name}</span>
      ) : null}
    </footer>
  )
}
