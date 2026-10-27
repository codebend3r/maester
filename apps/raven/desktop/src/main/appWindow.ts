import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { FILE_SCHEME, PAGE_ORIGIN, PLAYER_SOURCE_KINDS, WEB_HOST_PORT } from '@raven/core'
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, session, shell } from 'electron'
import { PLATFORMS } from '@/build/forgeOptions'
import type { AppLog } from '@/main/appLog'
import type { DesktopService } from '@/main/desktopService'
import { createFileHandler } from '@/main/fileProtocol'
import type { Grants } from '@/main/grants'
import { errorText } from '@/main/log/errorText'
import { describedFileId, openLine } from '@/main/log/opens'
import { setWindowBounds } from '@/main/playerState'
import { createRequestHandler } from '@/main/requestHandler'
import { isPermissionAllowed, isTrustedSender, navigationFor, windowOpenFor } from '@/main/security'
import type { StateStore, Timers } from '@/main/stateStore'
import {
  createWebHostHandler,
  listenWebHost,
  LOOPBACK_ADDRESSES,
  WEB_HOST_READY,
  webHostFailureText,
  webRootFor,
} from '@/main/webHost'
import { authOriginFrom } from '@/main/origins'
import { placeWindow } from '@/main/windowBounds'
import { IPC_CHANNELS } from '@/shared/hostNames'

export const PRODUCT_NAME = 'Raven'
// raven's night, so the window never flashes white before the page paints.
export const NIGHT = '#15201e'

type ShowWindowButtonsProps = {
  window: BrowserWindow
  isVisible: boolean
}

/** The traffic lights are macOS's; elsewhere there is nothing to show or hide. */
export const showWindowButtons = ({ window, isVisible }: ShowWindowButtonsProps): void => {
  if (process.platform !== PLATFORMS.darwin) return
  window.setWindowButtonVisibility(isVisible)
}

type StartWebHostProps = {
  serverOrigin: string
  timers: Timers
  appLog: Pick<AppLog, 'log' | 'warn'>
}

/**
 * The web app, served from the loopback web host with `/api` passed on to the server. A
 * custom scheme cannot hold it: Chromium keeps no `document.cookie` there, where the web's
 * Supabase session lives. The port is fixed, so when another app holds it Raven says
 * so and quits rather than move the page to an origin with none of its sign-in or settings.
 */
export const startWebHost = async ({
  serverOrigin,
  timers,
  appLog: { log, warn },
}: StartWebHostProps): Promise<void> => {
  // A test hook too: an unpackaged run may let the page sign in at a stand-in Supabase Auth.
  const authOrigin = authOriginFrom({ isPackaged: app.isPackaged, env: process.env, warn })
  const handler = createWebHostHandler({
    root: webRootFor({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    }),
    serverOrigin,
    authOrigin,
    readFile: (path) => readFile(path),
    timers,
    warn,
    info: (message) => log.info(message),
  })
  try {
    await listenWebHost({
      createServer: (listener) => createServer(listener),
      handler,
      port: WEB_HOST_PORT,
      addresses: LOOPBACK_ADDRESSES,
      warn,
    })
  } catch (error) {
    dialog.showErrorBox('Raven could not open', webHostFailureText(error))
    throw error
  }
  log.info(`${WEB_HOST_READY} at ${PAGE_ORIGIN}, /api goes to ${serverOrigin}`)
}

type ServeFilesProps = { grants: Grants }

/** The `raven-file:` scheme: a granted file's bytes, by range, for the page's `<video>`. */
export const serveFiles = ({ grants }: ServeFilesProps): void => {
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

type SecureContentsProps = { warn: AppLog['warn'] }

/** Every web contents: no permission, no webview, and a navigation stays on the page or goes to the browser. */
export const secureContents = ({ warn }: SecureContentsProps): void => {
  const openInBrowser = (url: string): void => {
    shell.openExternal(url).catch((error: unknown) => {
      warn(`Raven could not open a link in the browser. ${errorText(error)}`)
    })
  }

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isPermissionAllowed(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    isPermissionAllowed(permission),
  )

  type KeepOnPageProps = { url: string; preventDefault: () => void }

  // A navigation, or a redirect on the way to one, stays on the page or goes to the browser.
  const keepOnPage = (event: KeepOnPageProps): void => {
    const decision = navigationFor(event.url)
    if (decision.isAllowed) return
    event.preventDefault()
    if (decision.shouldOpenExternally) openInBrowser(event.url)
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', keepOnPage)
    contents.on('will-redirect', keepOnPage)
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      const decision = windowOpenFor(url)
      if (decision.shouldOpenExternally) openInBrowser(url)
      return { action: decision.action }
    })
  })
}

type AnswerRequestsProps = {
  service: DesktopService
  grants: Grants
  appLog: Pick<AppLog, 'log' | 'warn'>
}

/** The page's requests over IPC, answered by the desktop service once the sender is trusted. */
export const answerRequests = ({ service, grants, appLog: { log, warn } }: AnswerRequestsProps) => {
  const answer = createRequestHandler({
    isTrustedSender,
    // The page describes a file as it opens it, so this is where a local open is logged.
    handle: (envelope) => {
      const fileId = describedFileId(envelope)
      const file = fileId === null ? null : grants.fileOf(fileId)
      if (file !== null) log.info(openLine({ kind: PLAYER_SOURCE_KINDS.file, path: file.path }))
      return service.handle(envelope)
    },
    warn,
  })
  ipcMain.handle(IPC_CHANNELS.request, (event, payload: unknown) =>
    answer({ frameUrl: event.senderFrame?.url ?? null, payload }),
  )
}

type OpenWindowProps = {
  store: StateStore
  /** When main began, so the launch mark measures to the first frame. */
  launchedAt: number
  appLog: Pick<AppLog, 'log' | 'mark' | 'reportError'>
}

/** The one window, placed where it was last, shown on its first frame and loading the page. */
export const openWindow = ({
  store,
  launchedAt,
  appLog: { log, mark, reportError },
}: OpenWindowProps): BrowserWindow => {
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
    mark(`raven-launch-ms ${Math.round(performance.now() - launchedAt)}\n`)
  })

  const remember = (): void => {
    // Full screen and minimised bounds are not where the window should reopen.
    if (window.isFullScreen() || window.isMinimized()) return
    const current = window.getBounds()
    const displayId = screen.getDisplayMatching(current).id
    store.update((state) => setWindowBounds({ state, bounds: { ...current, displayId } }))
  }
  window.on('moved', remember)
  window.on('resized', remember)

  window
    .loadURL(`${PAGE_ORIGIN}/`)
    .then(() => log.info(`Raven loaded ${PAGE_ORIGIN}/`))
    .catch((error: unknown) => {
      reportError({ text: 'Raven could not load its page.', error })
    })
  return window
}
