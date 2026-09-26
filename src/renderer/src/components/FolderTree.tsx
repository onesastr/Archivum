import { Fragment, useCallback, useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  Star,
  Loader2,
  Network
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { formatCount } from '@shared/formats'
import { cn } from '@/lib/utils'
import type { TreeNode } from '@/hooks/useLibrary'

const api = window.archivum

export function FolderTree({
  tree,
  expanded,
  selectedFolder,
  onSelect,
  onToggle
}: {
  tree: TreeNode[]
  expanded: Set<string>
  selectedFolder: string | null
  onSelect: (path: string) => void
  onToggle: (path: string) => void
}) {
  const favorites = tree.filter((node) => node.kind === 'volume' && node.favorite)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Sources
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void api.dialog.pickFolder('Add a folder to Archivum')}
        >
          Add
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {favorites.length > 0 ? (
            <>
              <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Favorites
              </div>
              {favorites.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  selectedFolder={selectedFolder}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              ))}
              <Separator className="my-2" />
            </>
          ) : null}

          {tree.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No volumes found. Add a folder to get started.
            </p>
          ) : (
            tree.map((node) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                selectedFolder={selectedFolder}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedFolder,
  onSelect,
  onToggle
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  selectedFolder: string | null
  onSelect: (path: string) => void
  onToggle: (path: string) => void
}) {
  const [favorite, setFavorite] = useState(node.favorite)
  const isOpen = expanded.has(node.path)
  const isSelected = selectedFolder === node.path

  const handleClick = useCallback(() => {
    onSelect(node.path)
    if (!node.loaded) onToggle(node.path)
  }, [node.loaded, node.path, onSelect, onToggle])

  const toggleFavorite = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const next = !favorite
      setFavorite(next)
      void api.folders.setFavorite(node.path, next)
    },
    [favorite, node.path]
  )

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={node.hasChildren ? isOpen : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleClick()
          }
          if (event.key === 'ArrowRight' && !isOpen) onToggle(node.path)
          if (event.key === 'ArrowLeft' && isOpen) onToggle(node.path)
        }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          'group flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md pr-1 text-xs outline-none transition-colors',
          'hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring',
          isSelected ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground/85'
        )}
      >
        <button
          type="button"
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node.path)
          }}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground',
            !node.hasChildren && 'invisible'
          )}
        >
          {node.loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ChevronRight className={cn('size-3 transition-transform', isOpen && 'rotate-90')} />
          )}
        </button>

        {node.kind === 'volume' ? (
          node.network ? (
            <Network className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : isOpen ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1 truncate">{node.label}</span>

        {node.fileCount > 0 ? (
          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
            {formatCount(node.fileCount)}
          </span>
        ) : null}

        <button
          type="button"
          aria-label={favorite ? 'Unpin folder' : 'Pin folder'}
          onClick={toggleFavorite}
          className={cn(
            'shrink-0 rounded p-0.5 transition-opacity hover:text-foreground',
            favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
          )}
        >
          <Star className={cn('size-3', favorite && 'fill-primary text-primary')} />
        </button>
      </div>

      {isOpen && node.children.length > 0 ? (
        <Fragment>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedFolder={selectedFolder}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </Fragment>
      ) : null}
    </>
  )
}
