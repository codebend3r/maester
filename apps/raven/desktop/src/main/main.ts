import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { VIDEO_EXTENSIONS } from '@raven/core'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type OpenDialogOptions,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { createAppHandler } from '@/main/appProtocol'
import { createDesktopService, type DesktopService } from '@/main/desktopService'
import { createFileHandler } from '@/main/fileProtocol'
import { createGrants, type Grants } from '@/main/grants'
import { menuTemplate } from '@/main/menu'
import { createOpenBatch, eventForOpen, launchPaths } from '@/main/openBatch'
import { setWindowBounds } from '@/main/playerState'
import { createQuitGate } from '@/main/quitGate'
import { createRequestHandler } from '@/main/requestHandler'
import { isAppUrl, isPermissionAllowed, isTrustedSender, windowOpenFor } from '@/main/security'
import { createStateStore, loadState, type StateFs, type StateStore } from '@/main/stateStore'
import { createNodeTimers } from '@/main/timers'
import { placeWindow } from '@/main/windowBounds'
import {
  APP_ORIGIN,
  APP_SCHEME,
  type DesktopEvent,
  type DesktopReply,
  EVENT_CHANNEL,
  FILE_SCHEME,
  REQUEST_CHANNEL,
} from '@/shared/protocol'

const launchedAt = performance.now()

const PRODUCT_NAME = 'raven player'
const LINK_NOTICE = 'raven links open server titles, which this version cannot play yet.'
// Finder sends one `open-file` per file; this gathers a multi-file open into one batch.
const OPEN_BATCH_MS = 100
const STATE_DEBOUNCE_MS = 2000
const QUIT_FLUSH_MS = 1000
// raven's night, so the window never flashes white before the page paints.
const NIGHT = '#15201e'

const timers = createNodeTimers()

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
  const reveal = (): void => {
    const window = windows.current
    if (window === null || window.isDestroyed()) return
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
      // The page sends `ready` once per mount; a reload sends it again, which the batches ignore.
      onReady: () => {
        fileBatch.ready()
        linkBatch.ready()
      },
      newId: randomUUID,
      now: Date.now,
    })

    const quitGate = createQuitGate({
      isDirty: store.isDirty,
      flush: store.flush,
      timeoutMs: QUIT_FLUSH_MS,
      quit: () => app.quit(),
      exit: () => app.exit(0),
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
          },
        }),
      ),
    )
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
    })

    windows.current = openWindow({ store })
    windows.current.on('closed', () => {
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

if (app.requestSingleInstanceLock()) {
  startApp()
} else {
  // Another raven player is running; it receives this launch's files through `second-instance`.
  app.quit()
}
