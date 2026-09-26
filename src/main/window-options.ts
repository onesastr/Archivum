import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The window draws its own titlebar and manages traffic lights / window buttons
 * itself. Electron's `titleBarOverlay` is unreliable under Wayland compositors,
 * and a photo browser looks wrong with a heavyweight native frame.
 */
export function createWindowOptions(): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // The preload only needs `electron` plus code Vite inlines, so it runs
      // inside the OS sandbox rather than with full Node access.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  }

  if (process.platform === 'win32') {
    base.frame = false
  }

  return base
}
