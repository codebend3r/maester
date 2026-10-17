import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { VIDEO_EXTENSIONS } from '@raven/core'
import { type Mpv, type MpvSurface, openMpv } from '@raven/mpv'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  type MessagePortMain,
  type OpenDialogOptions,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { createAppHandler } from '@/main/appProtocol'
import {
  CONFIG_FILE,
  type ConfigStore,
  EMPTY_CONFIG,
  isDesktopConfig,
  setOutput,
} from '@/main/desktopConfig'
import { createDesktopService, type DesktopService } from '@/main/desktopService'
import { createFileHandler } from '@/main/fileProtocol'
import { createGrants, type Grants } from '@/main/grants'
import { menuTemplate } from '@/main/menu'
import { createOpenBatch, eventForOpen, launchPaths } from '@/main/openBatch'
import { CLEAR, createActivity } from '@/main/player/activity'
import { createConnector } from '@/main/player/connector'
import { displayReading } from '@/main/player/displayOptions'
import { addonPathFor, engineModeFrom, engineOptionsFor, openEngine } from '@/main/player/engine'
import { createEngineSlot, watchService } from '@/main/player/engineSlot'
import { createMarks } from '@/main/player/marks'
import { readDevices } from '@/main/player/outputOptions'
import type { PortLike } from '@/main/player/playerPort'
import {
  createPlayerService,
  type PlayerService,
  resolveSourceWith,
} from '@/main/player/playerService'
import { createSleepGuard } from '@/main/player/sleepGuard'
import { setWindowBounds } from '@/main/playerState'
import { createQuitGate } from '@/main/quitGate'
import { createRequestHandler } from '@/main/requestHandler'
import { isAppUrl, isPermissionAllowed, isTrustedSender, windowOpenFor } from '@/main/security'
import {
  closeTimeoutFor,
  createShutdown,
  DESTROY_MS,
  hardExitFor,
  QUIT_FLUSH_MS,
} from '@/main/shutdown'
import {
  createJsonStore,
  createStateStore,
  loadJson,
  loadState,
  type StateFs,
  type StateStore,
} from '@/main/stateStore'
import { createNodeTimers } from '@/main/timers'
import { placeWindow } from '@/main/windowBounds'
import {
  APP_ORIGIN,
  APP_SCHEME,
  type DesktopEvent,
  type DesktopReply,
  EVENT_CHANNEL,
  FILE_SCHEME,
  PLAYER_PORT_CHANNEL,
  REQUEST_CHANNEL,
} from '@/shared/protocol'
import { messageOf } from '@/shared/messageOf'

const launchedAt = performance.now()

const PRODUCT_NAME = 'raven player'
const LINK_NOTICE = 'raven links open server titles, which this version cannot play yet.'
// Finder sends one `open-file` per file; this gathers a multi-file open into one batch.
const OPEN_BATCH_MS = 100
const STATE_DEBOUNCE_MS = 2000
// raven's night, so the window never flashes white before the page paints.
const NIGHT = '#15201e'

const timers = createNodeTimers()

/** The traffic lights are macOS's; elsewhere there is nothing to show or hide. */
const showWindowButtons = ({
  window,
  isVisible,
}: {
  window: BrowserWindow
  isVisible: boolean
}): void => {
  if (process.platform !== 'darwin') return
  window.setWindowButtonVisibility(isVisible)
}

const warn = (message: string): void => {
  console.warn(message)
}

const userDataDir = (): string => {
  // A test hook: a packaged app never reads it, so the environment cannot move its data.
  const override = app.isPackaged ? undefined : process.env.RAVEN_DESKTOP_USER_DATA
  if (override !== undefined && override !== '') return override
  return join(app.getPath('appData'), 'raven')
}

const userData = userDataDir()
// Before the single instance lock, which is keyed by the userData directory.
app.setPath('userData', userData)

const startApp = (): void => {
  app.enableSandbox()
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      // standard: a real origin (app://raven) with relative URLs; secure: treated like https;
      // supportFetchAPI: the page's own fetch of its files; corsEnabled: module scripts load
      // through CORS. None of them bypasses the CSP.
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: FILE_SCHEME,
      // standard and secure: a media source the secure page may load; stream: `<video>` reads
      // the response as it arrives and asks for byte ranges. It does not bypass the CSP,
      // which names `raven-file:` in `media-src`.
      privileges: { standard: true, secure: true, stream: true },
    },
  ])

  const windows: { current: BrowserWindow | null } = { current: null }
  const players: { current: WindowPlayer | null } = { current: null }
  const currentEngine = (): NativeEngine | null => {
    const player = players.current
    return player === null ? null : player.engine.current()
  }
  // Timer callbacks (the open batches) call this too, so a closing window must not throw.
  const send = (event: DesktopEvent): void => {
    const window = windows.current
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return
    try {
      window.webContents.send(EVENT_CHANNEL, event)
    } catch (error) {
      console.warn('raven player could not reach its window.', error)
    }
  }
  const liveWindow = (): BrowserWindow | null => {
    const window = windows.current
    if (window === null || window.isDestroyed()) return null
    return window
  }
  const toggleDevTools = (): void => {
    const window = liveWindow()
    if (window === null) return
    const { webContents } = window
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools()
      return
    }
    webContents.openDevTools({ mode: 'detach' })
  }
  const reveal = (): void => {
    const window = liveWindow()
    if (window === null) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  const announce = (reply: DesktopReply): void => {
    const event = eventForOpen(reply)
    if (event !== null) send(event)
  }

  // Resolves once the window is open. The batches deliver only after the page's `ready`,
  // which the window's page sends, so by then it has resolved.
  const services: { ready: Promise<DesktopService> | null } = { ready: null }
  const openFromMain = async (paths: readonly string[]): Promise<void> => {
    const service = await services.ready
    if (service === null) return
    announce(await service.openPaths(paths))
    reveal()
  }

  const fileBatch = createOpenBatch<string>({
    delayMs: OPEN_BATCH_MS,
    timers,
    deliver: (paths) => {
      openFromMain(paths).catch((error: unknown) => {
        console.error('raven player could not open those files.', error)
      })
    },
  })
  // P4 cannot play server titles, so every link is answered with one notice per batch.
  const linkBatch = createOpenBatch<string>({
    delayMs: OPEN_BATCH_MS,
    timers,
    deliver: () => {
      send({ type: 'notice', message: LINK_NOTICE })
      reveal()
    },
  })

  app.on('second-instance', (_event, argv) => {
    reveal()
    launchPaths({ argv, isDefaultApp: process.defaultApp }).forEach(fileBatch.push)
  })

  // Registered here so a cold launch from Finder or a link still reaches them.
  app.on('will-finish-launching', () => {
    app.on('open-file', (event, path) => {
      event.preventDefault()
      fileBatch.push(path)
    })
    app.on('open-url', (event, url) => {
      event.preventDefault()
      linkBatch.push(url)
    })
  })
  launchPaths({ argv: process.argv, isDefaultApp: process.defaultApp }).forEach(fileBatch.push)

  const stateFile = join(userData, 'player-state.json')
  const stateFs: StateFs = {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, data) => writeFile(path, data, 'utf8'),
    rename: (from, to) => rename(from, to),
  }

  const createService = async (): Promise<DesktopService> => {
    const store = createStateStore({
      fs: stateFs,
      file: stateFile,
      initial: await loadState({ fs: stateFs, file: stateFile, now: Date.now }),
      timers,
      debounceMs: STATE_DEBOUNCE_MS,
      onError: (error) => {
        console.error('raven player could not save its state.', error)
      },
    })
    const configFile = join(userData, CONFIG_FILE)
    // Written on the next tick after a change.
    const config = createJsonStore({
      fs: stateFs,
      file: configFile,
      initial: await loadJson({
        fs: stateFs,
        file: configFile,
        now: Date.now,
        guard: isDesktopConfig,
        empty: EMPTY_CONFIG,
      }),
      timers,
      debounceMs: 0,
      onError: (error) => {
        console.error('raven player could not save its settings.', error)
      },
    })
    const grants = createGrants({ fs: { realpath, stat }, newId: randomUUID })

    const showOpenDialog = async (): Promise<string[]> => {
      const options = {
        filters: [{ name: 'Videos', extensions: [...VIDEO_EXTENSIONS] }],
        properties: ['openFile', 'multiSelections'],
      } satisfies OpenDialogOptions
      const window = windows.current
      const result =
        window === null
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(window, options)
      return result.canceled ? [] : result.filePaths
    }

    const service = createDesktopService({
      grants,
      store,
      readdir: (dir) => readdir(dir),
      showOpenDialog,
      addRecentDocument: (path) => app.addRecentDocument(path),
      clearRecentDocuments: () => app.clearRecentDocuments(),
      stat: (path) => stat(path),
      timers,
      // The page sends `ready` once per mount; a reload sends it again, which the batches ignore
      // and which hands the new page a fresh player port (Ruling 12).
      onReady: () => {
        fileBatch.ready()
        linkBatch.ready()
        const player = players.current
        if (player === null) return
        player.connect().catch((error: unknown) => {
          warn(`raven player could not hand the page its player: ${messageOf(error)}`)
        })
      },
      onError: (error) => {
        console.error('raven player failed to answer a request.', error)
      },
      newId: randomUUID,
      now: Date.now,
      output: {
        read: async () => {
          const engine = currentEngine()
          return {
            output: config.read().output,
            devices: await readDevices(engine?.mpv ?? null),
            isEngineReady: engine !== null,
          }
        },
        write: async (output) => {
          config.update((current) => setOutput({ config: current, output }))
          const engine = currentEngine()
          if (engine === null) return
          await engine.service.applyOutput({ output, devices: await readDevices(engine.mpv) })
        },
      },
      setWindowButtons: (isVisible) => {
        const window = liveWindow()
        if (window === null) return
        showWindowButtons({ window, isVisible })
      },
    })

    // mpv stops before the stores flush and before Electron tears the window down.
    const shutdown = createShutdown({
      engine: {
        isAlive: () => players.current !== null && players.current.engine.isAlive(),
        destroy: () =>
          players.current === null ? Promise.resolve() : players.current.engine.destroy(),
      },
      stores: [store, config],
      warn,
      wait: (ms) => sleep(ms),
    })
    const quitGate = createQuitGate({
      isDirty: shutdown.isPending,
      flush: shutdown.settle,
      timeoutMs: QUIT_FLUSH_MS,
      quit: () => app.quit(),
      // Reached when the flush timed out or the stores are still dirty; see `hardExitFor`
      // for why a live mpv means killing the process, and what that costs.
      exit: () => {
        const isEngineAlive = players.current !== null && players.current.engine.isAlive()
        const ending = hardExitFor({ isEngineAlive })
        switch (ending) {
          case 'kill':
            process.kill(process.pid, 'SIGKILL')
            return
          case 'exit':
            app.exit(0)
            return
          default: {
            const unreachable: never = ending
            return unreachable
          }
        }
      },
      wait: (ms) => sleep(ms),
    })
    // Both, because the page's last `savePosition` can land between them.
    app.on('before-quit', quitGate)
    app.on('will-quit', quitGate)

    await app.whenReady()
    serveSchemes({ grants })
    secureContents()
    answerRequests({ service })

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        menuTemplate({
          appName: PRODUCT_NAME,
          isDevelopment: !app.isPackaged,
          actions: {
            openDialog: () => {
              service
                .openDialog()
                .then(announce)
                .catch((error: unknown) => {
                  console.error('raven player could not show the open dialog.', error)
                })
            },
            send,
            toggleDevTools,
          },
        }),
      ),
    )
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
    })

    const window = openWindow({ store })
    windows.current = window
    players.current = attachPlayer({ window, grants, config })
    window.on('closed', () => {
      windows.current = null
    })
    return service
  }

  services.ready = createService()
  services.ready.catch((error: unknown) => {
    console.error('raven player could not start.', error)
    app.exit(1)
  })

  // One window: closing it quits, which runs the quit gate.
  app.on('window-all-closed', () => app.quit())
}

const serveSchemes = ({ grants }: { grants: Grants }): void => {
  protocol.handle(
    APP_SCHEME,
    createAppHandler({
      root: join(app.getAppPath(), 'dist', 'renderer'),
      readFile: (path) => readFile(path),
    }),
  )
  protocol.handle(
    FILE_SCHEME,
    createFileHandler({
      grants,
      stat: (path) =>
        stat(path).then(
          ({ size }) => ({ size }),
          () => null,
        ),
      readRange: ({ path, start, end }) => Readable.toWeb(createReadStream(path, { start, end })),
    }),
  )
}

const secureContents = (): void => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isPermissionAllowed(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    isPermissionAllowed(permission),
  )

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => {
      if (!isAppUrl(event.url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      const decision = windowOpenFor(url)
      if (decision.shouldOpenExternally) {
        shell.openExternal(url).catch((error: unknown) => {
          console.warn('raven player could not open a link in the browser.', error)
        })
      }
      return { action: decision.action }
    })
  })
}

const answerRequests = ({ service }: { service: DesktopService }): void => {
  const answer = createRequestHandler({
    isTrustedSender,
    handle: service.handle,
    warn: (message) => {
      console.warn(message)
    },
  })
  ipcMain.handle(REQUEST_CHANNEL, (event, payload: unknown) =>
    answer({ frameUrl: event.senderFrame?.url ?? null, payload }),
  )
}

const openWindow = ({ store }: { store: StateStore }): BrowserWindow => {
  const bounds = placeWindow({
    saved: store.read().window,
    displays: screen.getAllDisplays(),
    primary: screen.getPrimaryDisplay(),
  })
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: NIGHT,
    title: PRODUCT_NAME,
    webPreferences: {
      preload: join(app.getAppPath(), 'dist', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
    if (!app.isPackaged) {
      process.stdout.write(`raven-launch-ms ${Math.round(performance.now() - launchedAt)}\n`)
    }
  })

  const remember = (): void => {
    // Full screen and minimised bounds are not where the window should reopen.
    if (window.isFullScreen() || window.isMinimized()) return
    const current = window.getBounds()
    const displayId = screen.getDisplayMatching(current).id
    store.update((state) => setWindowBounds(state, { bounds: { ...current, displayId } }))
  }
  window.on('moved', remember)
  window.on('resized', remember)

  window.loadURL(`${APP_ORIGIN}/`).catch((error: unknown) => {
    console.error('raven player could not load its page.', error)
  })
  return window
}

type NativeEngine = { mpv: Mpv; service: PlayerService }
type WindowPlayer = ReturnType<typeof attachPlayer>

// A test hook too: an unpackaged run reads `RAVEN_DESKTOP_MPV` (`headless` or `off`).
const engineMode = () => engineModeFrom({ isPackaged: app.isPackaged, env: process.env })

/** Electron's port behind the bridge's `PortLike`, so the bridge never sees Electron. */
const portLike = (port: MessagePortMain): PortLike => ({
  onMessage: (listener) => {
    port.on('message', (event) => listener(event.data))
  },
  onClose: (listener) => {
    port.on('close', listener)
  },
  post: (message) => port.postMessage(message),
  start: () => port.start(),
  close: () => port.close(),
})

const isPageLive = (window: BrowserWindow): boolean =>
  !window.isDestroyed() &&
  !window.webContents.isDestroyed() &&
  isAppUrl(window.webContents.getURL())

/** The display the window is on, read for mpv; null once mpv is gone. */
const displayOf = ({ window, mpv }: { window: BrowserWindow; mpv: Mpv }) => {
  if (window.isDestroyed()) return null
  return displayReading({
    frequency: screen.getDisplayMatching(window.getBounds()).displayFrequency,
    display: () => mpv.display(),
  })
}

const applyDisplayTo = async ({
  window,
  engine,
}: {
  window: BrowserWindow
  engine: NativeEngine
}): Promise<void> => {
  const reading = displayOf({ window, mpv: engine.mpv })
  if (reading === null) return
  await engine.service.applyDisplay(reading)
}

/**
 * One window's player: its engine (opened once, under the page), the port hand-over,
 * what playing does to the window and the display, and the close that waits for mpv.
 */
const attachPlayer = ({
  window,
  grants,
  config,
}: {
  window: BrowserWindow
  grants: Grants
  config: ConfigStore
}) => {
  const mode = engineMode()
  // mpv's events arrive from the moment it opens; the service exists a moment later.
  const sink: { service: PlayerService | null } = { service: null }
  const marks = createMarks({
    isEnabled: !app.isPackaged,
    now: () => performance.now(),
    write: (line) => {
      process.stdout.write(line)
    },
    timers,
    histogram: () => monitorEventLoopDelay({ resolution: 10 }),
  })
  const sleepGuard = createSleepGuard({
    start: () => powerSaveBlocker.start('prevent-display-sleep'),
    stop: (id) => powerSaveBlocker.stop(id),
  })
  const activity = createActivity({
    onPlaying: (isPlaying) => {
      sleepGuard.set(isPlaying)
      marks.playing(isPlaying)
    },
    onShowing: (isShowing) => {
      if (window.isDestroyed()) return
      window.setBackgroundColor(isShowing ? CLEAR : NIGHT)
      // Home always shows the traffic lights, whatever the watch route last asked for.
      if (!isShowing) showWindowButtons({ window, isVisible: true })
    },
  })

  const surfaceFor = (kind: 'window' | 'headless'): MpvSurface =>
    kind === 'window' ? { kind, handle: window.getNativeWindowHandle() } : { kind }

  const openNative = async (surface: MpvSurface): Promise<NativeEngine> => {
    const mpv = await openMpv({
      surface,
      // Always explicit: the addon and libmpv sit outside the bundle (Ruling 2).
      addonPath: addonPathFor({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      }),
      onEvent: (event) => {
        if (sink.service !== null) sink.service.receive(event)
      },
    })
    try {
      await Promise.all(engineOptionsFor({ surface }).map((option) => mpv.set(option)))
      // Made before anything can load: it hardens mpv first and refuses loads if that fails.
      const service = createPlayerService({
        mpv,
        resolveSource: resolveSourceWith({ grants }),
        canChooseAo: mode === 'window',
        timers,
        onActivity: activity.report,
        onFirstFrame: marks.firstFrame,
        warn,
      })
      sink.service = service
      const engine = { mpv, service: marks.tracking(service) }
      await service.applyOutput({ output: config.read().output, devices: await readDevices(mpv) })
      await applyDisplayTo({ window, engine })
      return engine
    } catch (error) {
      await mpv.destroy()
      throw error
    }
  }

  const engine = createEngineSlot<NativeEngine>({
    open: () =>
      openEngine({
        mode,
        surfaceFor,
        open: openNative,
        warn: (message) => warn(`raven player could not open its video engine: ${message}`),
      }),
    destroyOf: ({ mpv }) => mpv.destroy(),
    watch: watchService,
    warn,
  })

  const connector = createConnector({
    engine: engine.get,
    channel: () => {
      const { port1, port2 } = new MessageChannelMain()
      return { local: portLike(port1), remote: port2 }
    },
    post: ({ connection, ports }) => {
      if (!isPageLive(window)) throw new Error('its page is gone.')
      window.webContents.postMessage(PLAYER_PORT_CHANNEL, connection, ports)
    },
    warn,
    timers,
  })

  const startEngine = () => {
    engine.get().catch((error: unknown) => {
      warn(`raven player could not open its video engine: ${messageOf(error)}`)
    })
  }
  // Whichever comes first of this and the page's `ready` (through the connector).
  window.once('ready-to-show', startEngine)

  const followDisplay = () => {
    const current = engine.current()
    if (current === null) return
    applyDisplayTo({ window, engine: current }).catch((error: unknown) => {
      warn(`raven player could not follow the display: ${messageOf(error)}`)
    })
  }
  window.on('moved', followDisplay)
  window.on('enter-full-screen', followDisplay)
  window.on('leave-full-screen', followDisplay)
  screen.on('display-added', followDisplay)
  screen.on('display-removed', followDisplay)
  screen.on('display-metrics-changed', followDisplay)

  // A crashed page holds no port; stop what it was playing until its reload asks again,
  // and put the window back for Home even when the service had nothing left to stop.
  window.webContents.on('render-process-gone', () => {
    connector.disconnect()
    activity.hide()
  })

  // Each page load starts on Home, whatever the last one left the window showing.
  const connect = () => {
    activity.hide()
    return connector.connect()
  }

  // The window goes only once mpv has stopped drawing into it.
  window.on(
    'close',
    createQuitGate({
      isDirty: engine.isAlive,
      flush: engine.destroy,
      timeoutMs: DESTROY_MS,
      quit: () => window.close(),
      exit: () => {
        const ending = closeTimeoutFor({ isEngineAlive: engine.isAlive() })
        switch (ending) {
          case 'quitApp':
            // The app's gate flushes the stores, then ends the process however it must.
            app.quit()
            return
          case 'destroyWindow':
            window.destroy()
            return
          default: {
            const unreachable: never = ending
            return unreachable
          }
        }
      },
      wait: (ms) => sleep(ms),
    }),
  )
  window.on('closed', () => {
    connector.disconnect()
    sleepGuard.set(false)
    marks.playing(false)
    screen.off('display-added', followDisplay)
    screen.off('display-removed', followDisplay)
    screen.off('display-metrics-changed', followDisplay)
  })

  return { engine, connect }
}

if (app.requestSingleInstanceLock()) {
  startApp()
} else {
  // Another raven player is running; it receives this launch's files through `second-instance`.
  app.quit()
}
