import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const api = window.archivum

export function TitleBar({ title, subtitle }: { title: string; subtitle: string | null }) {
  const [platform, setPlatform] = useState<string>('linux')
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void api.window.state().then((state) => {
      setPlatform(state.platform)
      setMaximized(state.maximized)
    })
    return api.events.on('window:stateChanged', (state) => {
      setMaximized(state.maximized)
    })
  }, [])

  const isMac = platform === 'darwin'

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className={cn('flex items-center gap-2', isMac ? 'pl-16' : 'pl-1')}>
        <span className="text-sm font-semibold tracking-tight">Archivum</span>
      </div>

      <div className="flex min-w-0 flex-1 items-baseline gap-2 justify-center">
        <span className="truncate text-xs text-muted-foreground">{title}</span>
        {subtitle ? (
          <>
            <span className="text-muted-foreground/50">/</span>
            <span className="truncate text-xs text-muted-foreground/80">{subtitle}</span>
          </>
        ) : null}
      </div>

      {!isMac ? <WindowButtons maximized={maximized} /> : null}
    </header>
  )
}

function WindowButtons({ maximized }: { maximized: boolean }) {
  return (
    <div
      className="flex items-center gap-0.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-8 rounded-md"
        onClick={() => void api.window.minimize()}
        aria-label="Minimize"
      >
        <Minus className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 rounded-md"
        onClick={() => void api.window.toggleMaximize()}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 rounded-md hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => void api.window.close()}
        aria-label="Close"
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}
