import { join } from 'node:path'
import { app, BrowserWindow, protocol, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { THUMB_SCHEME } from '../shared/contract'
import { registerIpc } from './ipc'
import { registerAssetProtocol } from './protocol'
import { AppServices } from './services'
import { createWindowOptions } from './window-options'

const isDev = !app.isPackaged

/**
 * Electron silently falls back to XWayland unless ozone is told otherwise.
 * Hyprland sessions report `wayland` in XDG_SESSION_TYPE, so ask for the native
 * backend there and leave Xorg sessions alone.
 */
function applyDisplayPreferences(): void {
  if (process.platform !== 'linux') return
  if ((process.env.XDG_SESSION_TYPE ?? '').toLowerCase() !== 'wayland') return
  app.commandLine.appendSwitch('ozone-platform', 'wayland')
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: THUMB_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

applyDisplayPreferences()

class ArchivumApp {
  private window: BrowserWindow | null = null
  private services: AppServices | null = null

  async start(): Promise<void> {
    app.on('browser-window-created', (_event, browserWindow) => {
      optimizer.watchWindowShortcuts(browserWindow)
    })

    app.whenReady().then(async () => {
      electronApp.setAppUserModelId('com.archivum.app')

      this.services = await AppServices.create(app.getPath('userData'), (channel, payload) => {
        this.window?.webContents.send(channel, payload)
      })

      registerAssetProtocol(this.services)
      registerIpc(this.services, () => this.window)

      this.createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) this.createWindow()
      })
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })

    app.on('before-quit', () => {
      void this.services?.dispose()
    })

    app.on('open-url', (event, url) => {
      event.preventDefault()
      void this.handleDeepLink(url)
    })
  }

  private async handleDeepLink(url: string): Promise<void> {
    if (url.startsWith('archivum://open?path=')) {
      const target = new URL(url).searchParams.get('path')
      if (target) await shell.openPath(target)
    }
  }

  private createWindow(): void {
    const window = new BrowserWindow(createWindowOptions())
    this.window = window
    this.services?.attachWindow(window)

    window.once('ready-to-show', () => window.show())

    window.on('closed', () => {
      this.window = null
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (isDev && devUrl) {
      void window.loadURL(devUrl)
    } else {
      void window.loadFile(join(app.getAppPath(), 'out/renderer/index.html'))
    }
  }
}

void new ArchivumApp().start()
