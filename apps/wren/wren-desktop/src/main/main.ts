import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { WREN_HOST_PORT, WREN_PAGE_ORIGIN } from '@raven/wren'
import { BrowserWindow, Menu, app, dialog, screen, session, shell } from 'electron'
import {
  LOOPBACK_ADDRESSES,
  createNodeTimers,
  errorText,
  isPortTaken,
  listenWebHost,
  webRootFor,
} from '@shared/desktop'
import { APP_ICON, WEB_DIST } from '@/build/forgeOptions'
import { DESKTOP_COPY, PRODUCT_NAME } from '@/main/copy'
import { EVENTS } from '@/main/events'
import { WEB_SITE, menuTemplate } from '@/main/menu'
import { serverOriginFrom } from '@/main/origins'
import { isPermissionAllowed, navigationFor, windowOpenFor } from '@/main/security'
import { userDataFrom } from '@/main/userData'
import { createWrenHostHandler } from '@/main/webHost'
import { MIN_SIZE, WINDOW_FILE, type WindowBounds, placeWindow } from '@/main/windowState'

// Wren's Night, so the window never flashes white before the page paints.
const NIGHT = '#101816'

const warn = (message: string): void => console.warn(message)

// The main process's own notes go to stderr beside its warnings, where Console.app and a terminal read them.
const info = (message: string): void => console.warn(message)

const openInBrowser = (url: string): void => {
  shell.openExternal(url).catch((error: unknown) => {
    warn(`Wren could not open a link in the browser. ${errorText(error)}`)
  })
}

/** Every web contents: only the permissions it needs, no webview, and it stays on the page. */
const secureContents = (): void => {
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

  app.on(EVENTS.webContentsCreated, (_event, contents) => {
    contents.on(EVENTS.willNavigate, keepOnPage)
    contents.on(EVENTS.willRedirect, keepOnPage)
    contents.on(EVENTS.willAttachWebview, (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      const decision = windowOpenFor(url)
      if (decision.shouldOpenExternally) openInBrowser(url)
      return { action: decision.action }
    })
  })
}

const windowFile = (): string => join(app.getPath('userData'), WINDOW_FILE)

const readSavedBounds = (): Promise<unknown> =>
  readFile(windowFile(), 'utf8').then(
    (text) => JSON.parse(text),
    () => null,
  )

const saveBounds = (bounds: WindowBounds): void => {
  writeFile(windowFile(), JSON.stringify(bounds)).catch((error: unknown) => {
    warn(`Wren could not keep where its window is. ${errorText(error)}`)
  })
}

/** Whether Wren is quitting, so closing the window quits rather than hides it. */
const quitting = { isQuitting: false }

/**
 * The one window, where it was last, loading the page. Closing it hides it, as the Music app's
 * does, so the queue keeps playing; Quit, or the Dock's, ends Wren.
 */
const openWindow = async (): Promise<BrowserWindow> => {
  const bounds = placeWindow({
    saved: await readSavedBounds(),
    areas: screen.getAllDisplays().map(({ workArea }) => workArea),
  })
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    backgroundColor: NIGHT,
    title: DESKTOP_COPY.title,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      // The queue's timers and its next song must not wait while the window is hidden.
      backgroundThrottling: false,
    },
  })
  window.once(EVENTS.readyToShow, () => window.show())

  const remember = (): void => {
    if (window.isFullScreen() || window.isMaximized() || window.isMinimized()) return
    saveBounds(window.getBounds())
  }
  window.on(EVENTS.moved, remember)
  window.on(EVENTS.resize, remember)
  window.on(EVENTS.close, (event) => {
    if (quitting.isQuitting) return
    event.preventDefault()
    window.hide()
  })

  window.loadURL(`${WREN_PAGE_ORIGIN}/`).catch((error: unknown) => {
    warn(`Wren could not load its page. ${errorText(error)}`)
  })
  return window
}

/**
 * Serves the web app from the loopback web host with `/api` passed on to raven. A custom scheme
 * cannot hold it: Chromium keeps no `document.cookie` there, where the page's Supabase session
 * lives. The port is fixed, so when another app holds it Wren says so and quits rather than move
 * the page to an origin with none of its sign-in or settings.
 */
const startWebHost = async (): Promise<void> => {
  const serverOrigin = serverOriginFrom({
    isPackaged: app.isPackaged,
    built: process.env.WREN_DESKTOP_SERVER_ORIGIN,
    env: process.env,
    warn,
  })
  const handler = createWrenHostHandler({
    root: webRootFor({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      webDist: WEB_DIST,
    }),
    serverOrigin,
    readFile: (path) => readFile(path),
    timers: createNodeTimers(),
    warn,
    info,
  })
  try {
    await listenWebHost({
      createServer: (listener) => createServer(listener),
      handler,
      port: WREN_HOST_PORT,
      addresses: LOOPBACK_ADDRESSES,
      warn,
    })
  } catch (error) {
    const text = isPortTaken(error)
      ? DESKTOP_COPY.portTaken
      : DESKTOP_COPY.cannotServe(errorText(error))
    dialog.showErrorBox(DESKTOP_COPY.cannotOpen, text)
    throw error
  }
  info(`Wren serves ${WREN_PAGE_ORIGIN}, /api goes to ${serverOrigin}`)
}

const start = async (): Promise<void> => {
  await app.whenReady()
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), `${APP_ICON}.png`))
  secureContents()
  await startWebHost()
  const window = await openWindow()
  const showWindow = (): void => {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        isPackaged: app.isPackaged,
        showWindow,
        openWebSite: () => openInBrowser(WEB_SITE),
      }),
    ),
  )
  app.on(EVENTS.activate, showWindow)
  app.on(EVENTS.secondInstance, showWindow)
}

app.setName(PRODUCT_NAME)
// Before the single instance lock, which is keyed by the userData directory.
const userData = userDataFrom({ isPackaged: app.isPackaged, env: process.env })
if (userData !== null) app.setPath('userData', userData)
app.on(EVENTS.beforeQuit, () => {
  quitting.isQuitting = true
})
// The window hides rather than closes, so this fires only on the way out.
app.on(EVENTS.windowAllClosed, () => app.quit())

if (app.requestSingleInstanceLock()) {
  start().catch((error: unknown) => {
    warn(`Wren could not start. ${errorText(error)}`)
    app.exit(1)
  })
} else {
  app.quit()
}
