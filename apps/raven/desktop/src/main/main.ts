import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  DESKTOP_EVENTS,
  type DesktopEvent,
  type DesktopReply,
  FILE_SCHEME,
  PAGE_ORIGIN,
  PLAYER_SOURCE_KINDS,
  VIDEO_EXTENSIONS,
  WEB_HOST_PORT,
} from '@raven/core'
import { MPV_PROPERTIES, MPV_SURFACE_KINDS, type Mpv, type MpvSurface, openMpv } from '@raven/mpv'
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  type MessagePortMain,
  net,
  type OpenDialogOptions,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { APP_ICON, PLATFORMS } from '@/build/forgeOptions'
import { createPageAccount } from '@/main/accounts/pageAccount'
import { createServerSignal } from '@/main/accounts/serverSignal'
import {
  BUDGET_WINDOW_MS,
  budgetWindowFrom,
  createBudgets,
  PLAYING_SAMPLE_MS,
  syncRetryFrom,
} from '@/main/budgets'
import {
  CONFIG_FILE,
  type ConfigStore,
  type FixedServer,
  loadConfig,
  type ServerEntry,
  namesServer,
  serverById,
  serverOf,
  setOutput,
} from '@/main/desktopConfig'
import { createDesktopService, type DesktopService } from '@/main/desktopService'
import { diagnosticsText, readEngineDiagnostics, unavailableReason } from '@/main/diagnostics'
import { settleDownloads } from '@/main/downloads/adopt'
import { createDownloadService, type DownloadService } from '@/main/downloads/downloadService'
import { DOWNLOADS_FILE } from '@/main/downloads/downloadState'
import { DOWNLOADS_DEBOUNCE_MS, loadDownloads } from '@/main/downloads/downloadStore'
import type { PartFile, StreamFetch } from '@/main/downloads/fetchFile'
import { createMediaAccess, type ProbeFetch } from '@/main/downloads/mediaAccess'
import { SYNC_RETRY_MS } from '@/main/downloads/sync'
import { createFileHandler } from '@/main/fileProtocol'
import { createGrants, type Grants } from '@/main/grants'
import { createHelpActions } from '@/main/help'
import { errorText } from '@/main/log/errorText'
import { createLog, logFsFrom, SILENT_LOG } from '@/main/log/log'
import { describedFileId, logsDirFor, openLine } from '@/main/log/opens'
import { menuTemplate } from '@/main/menu'
import { createOpenBatch, eventForOpen, launchPaths } from '@/main/openBatch'
import { CLEAR, createActivity } from '@/main/player/activity'
import { createConnector } from '@/main/player/connector'
import { displayReading } from '@/main/player/displayOptions'
import {
  addonPathFor,
  ENGINE_MESSAGES,
  ENGINE_MODES,
  ENGINE_STATUSES,
  engineModeFrom,
  engineOptionsFor,
  openEngine,
} from '@/main/player/engine'
import { createEngineSlot, watchService } from '@/main/player/engineSlot'
import { createMarks } from '@/main/player/marks'
import { readDevices } from '@/main/player/outputOptions'
import type { PortLike } from '@/main/player/playerPort'
import {
  createPlayerService,
  type PlayerActivity,
  type PlayerService,
  resolveSourceWith,
} from '@/main/player/playerService'
import { createSleepGuard } from '@/main/player/sleepGuard'
import { setWindowBounds } from '@/main/playerState'
import { createQuitGate } from '@/main/quitGate'
import { createQuitMark } from '@/main/quitMark'
import { createRequestHandler } from '@/main/requestHandler'
import {
  isPageUrl,
  isPermissionAllowed,
  isTrustedSender,
  navigationFor,
  windowOpenFor,
} from '@/main/security'
import { createAccountTickets } from '@/main/servers/accountTickets'
import { createLinkOpener } from '@/main/servers/linkOpener'
import {
  createMediaRelay,
  listenOnLoopback,
  type MediaRelay,
  type UpstreamFetch,
} from '@/main/servers/mediaRelay'
import { createServerCalls, fetchThrough } from '@/main/servers/serverCalls'
import { clearFormerPartitions, PARTITIONS_DIR } from '@/main/servers/formerSessions'
import { createPageUnlock } from '@/main/servers/pageUnlock'
import { createServerSources } from '@/main/servers/serverSources'
import { createServerTitles } from '@/main/servers/serverTitles'
import {
  CLOSE_TIMEOUTS,
  closeTimeoutFor,
  createShutdown,
  DESTROY_MS,
  endAfterLog,
  HARD_EXITS,
  hardExitFor,
  QUIT_FLUSH_MS,
} from '@/main/shutdown'
import {
  createJsonStore,
  createStateStore,
  isMissingFile,
  loadState,
  type StateFs,
  type StateStore,
} from '@/main/stateStore'
import { createNodeTimers } from '@/main/timers'
import { createMenuCheck, createUpdateService, updateSourceFrom } from '@/main/updateService'
import { checkForUpdates, type UpdateFetch } from '@/main/updates'
import {
  createWebHostHandler,
  listenWebHost,
  LOOPBACK_ADDRESSES,
  WEB_HOST_READY,
  webHostFailureText,
  webRootFor,
} from '@/main/webHost'
import { authOriginFrom, linkOriginsFrom, serverOriginFrom } from '@/main/origins'
import { placeWindow } from '@/main/windowBounds'
import { IPC_CHANNELS } from '@/shared/hostNames'

const launchedAt = performance.now()

const USER_DATA_HOOK = 'RAVEN_DESKTOP_USER_DATA'
/** Where an older raven player kept its own sign-ins, encrypted: the page signs in now. */
const FORMER_ACCOUNTS_DIR = 'accounts'

const PRODUCT_NAME = 'raven player'
const STORE_NOTICES = {
  state: 'raven player could not save your recent videos.',
  config: 'raven player could not save its settings.',
  downloads: 'raven player could not save its downloads.',
} as const
// Finder sends one `open-file` per file; this gathers a multi-file open into one batch.
const OPEN_BATCH_MS = 100
const STATE_DEBOUNCE_MS = 2000
// raven's night, so the window never flashes white before the page paints.
const NIGHT = '#15201e'

const timers = createNodeTimers()

// No cookie rides along, a redirect fails rather than carry the request elsewhere, and
// nothing is cached: the releases list, a media origin's probe and a ticketed download.
const fetchBare = ({
  url,
  init,
}: {
  url: string
  init: { headers: Record<string, string>; signal: AbortSignal }
}) => net.fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' })

const fetchReleases: UpdateFetch = fetchBare

/** The relay's requests to a server: the ticket rides on the URL, never a cookie, and a redirect fails. */
const fetchRelayed: UpstreamFetch = ({ url, method, headers, signal }) =>
  net.fetch(url, {
    method,
    headers,
    signal,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  })

/**
 * A media origin's probe, which `mediaAccess` times over the whole body. The timeout's signal
 * aborts the body's read too, so a probe that stalls mid-body fails at the timeout.
 */
const fetchProbe: ProbeFetch = ({ url, timeoutMs }) =>
  fetchBare({ url, init: { headers: {}, signal: AbortSignal.timeout(timeoutMs) } })

/** A download's `.part`, opened to append; its size is read from disk each time. */
const openPart = async (path: string): Promise<PartFile> => {
  const handle = await open(path, 'a+')
  return {
    size: async () => (await handle.stat()).size,
    append: (chunk) => handle.appendFile(chunk),
    truncate: () => handle.truncate(0),
    // On disk before the bytes it holds are counted, so a crash leaves a part the resume can trust.
    close: () => handle.datasync().finally(() => handle.close()),
  }
}

/** The traffic lights are macOS's; elsewhere there is nothing to show or hide. */
const showWindowButtons = ({
  window,
  isVisible,
}: {
  window: BrowserWindow
  isVisible: boolean
}): void => {
  if (process.platform !== PLATFORMS.darwin) return
  window.setWindowButtonVisibility(isVisible)
}

// A test hook: a packaged app never reads it, so the environment cannot move its data.
const userDataOverrideOf = (): string | null => {
  const override = app.isPackaged ? undefined : process.env[USER_DATA_HOOK]
  return override === undefined || override === '' ? null : override
}

const userDataOverride = userDataOverrideOf()
const userData = userDataOverride ?? join(app.getPath('appData'), 'raven')
// Before the single instance lock, which is keyed by the userData directory.
app.setPath('userData', userData)
// Before the reporter starts, which reads the path once (Ruling 11). Nothing is uploaded.
app.setPath('crashDumps', join(userData, 'Crashpad'))
crashReporter.start({ uploadToServer: false })
app.setAppLogsPath(logsDirFor({ home: app.getPath('home'), userDataOverride }))

// A second instance hands its files to the first and quits. It keeps no log: it would write
// a false launch into the first one's file and rotate that file from two processes.
const isPrimary = app.requestSingleInstanceLock()

const log = isPrimary
  ? createLog({
      dir: app.getPath('logs'),
      fs: logFsFrom({ mkdir, stat, appendFile, rename, rm }),
      now: Date.now,
      timers,
      onError: (error) => {
        console.error('raven player could not write its log.', error)
      },
    })
  : SILENT_LOG

const warn = (message: string): void => {
  log.warn(message)
  if (!app.isPackaged) console.warn(message)
}

const reportError = ({ text, error }: { text: string; error: unknown }): void => {
  const message = `${text} ${errorText(error)}`
  log.error(message)
  if (!app.isPackaged) console.error(message)
}

const reportEndFailure = (error: unknown): void => {
  console.error('raven player could not end.', error)
}

/** A budget mark (Ruling 13): always logged, and on stdout unpackaged, where e2e reads it. */
const mark = (line: string): void => {
  log.mark(line.trim())
  if (!app.isPackaged) process.stdout.write(line)
}

const startApp = (): void => {
  app.enableSandbox()
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_SCHEME,
      // standard and secure: a media source the secure page may load; stream: `<video>` reads
      // the response as it arrives and asks for byte ranges. It does not bypass the CSP,
      // which names `raven-file:` in `media-src`.
      privileges: { standard: true, secure: true, stream: true },
    },
  ])

  const quitMark = createQuitMark({ isEnabled: true, now: () => performance.now(), write: mark })
  app.on('before-quit', quitMark.started)
  // Not on `quit`, after which nothing waits for a write: ahead of the quit gate's own
  // `will-quit`, which then finds the mark in the log and holds the quit while it writes.
  // So `raven-quit-ms` ends before that last flush of the log, which it does not count.
  app.on('will-quit', quitMark.ended)

  const marks = createMarks({
    isEnabled: true,
    now: () => performance.now(),
    write: mark,
    timers,
    histogram: () => monitorEventLoopDelay({ resolution: 10 }),
  })
  // A file opened before the window is ready is a cold "Open With", timed to its first frame.
  const launch = { isWindowReady: false }

  // The server this build plays from, and the other origins its links may name it by. Each is
  // replaced by `bun build --define` with what the build was given.
  const fixedServer: FixedServer = {
    origin: serverOriginFrom({
      isPackaged: app.isPackaged,
      built: process.env.RAVEN_DESKTOP_SERVER_ORIGIN,
      env: process.env,
      warn,
    }),
    aliases: linkOriginsFrom({
      isPackaged: app.isPackaged,
      built: process.env.RAVEN_DESKTOP_LINK_ORIGINS,
      env: process.env,
      warn,
    }),
  }

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
      window.webContents.send(IPC_CHANNELS.event, event)
    } catch (error) {
      warn(`raven player could not reach its window. ${errorText(error)}`)
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
  const readDiagnostics = async (): Promise<string> => {
    const window = liveWindow()
    // Read before mpv is asked anything: the window may close while its reads are out.
    const displayHz =
      window === null ? null : screen.getDisplayMatching(window.getBounds()).displayFrequency
    const player = players.current
    const engine = currentEngine()
    return diagnosticsText({
      app: { version: app.getVersion(), isPackaged: app.isPackaged, arch: process.arch },
      os: process.getSystemVersion(),
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      engine:
        engine === null
          ? {
              kind: ENGINE_STATUSES.unavailable,
              reason: unavailableReason({
                mode: engineMode(),
                note: player === null ? null : player.engineNote(),
              }),
            }
          : await readEngineDiagnostics({ mpv: engine.mpv }),
      displayHz,
    })
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
        reportError({ text: 'raven player could not open those files.', error })
      })
    },
  })
  // Shown first, so the page that answers a link is on a window the person can see.
  const openLinksFromMain = async (links: readonly string[]): Promise<void> => {
    const service = await services.ready
    if (service === null) return
    reveal()
    announce(await service.openLinks(links))
    reveal()
  }

  // The opener acts on the first link of a burst and asks about one server at a time.
  const linkBatch = createOpenBatch<string>({
    delayMs: OPEN_BATCH_MS,
    timers,
    deliver: (links) => {
      openLinksFromMain(links).catch((error: unknown) => {
        reportError({ text: 'raven player could not open that link.', error })
      })
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
      if (!launch.isWindowReady) marks.opened()
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
    writeFile: ({ path, data }) => writeFile(path, data, 'utf8'),
    rename: ({ from, to }) => rename(from, to),
  }

  const createService = async (): Promise<DesktopService> => {
    const store = createStateStore({
      fs: stateFs,
      file: stateFile,
      initial: await loadState({ fs: stateFs, file: stateFile, now: Date.now }),
      timers,
      debounceMs: STATE_DEBOUNCE_MS,
      onError: (error) => {
        reportError({ text: 'raven player could not save its state.', error })
        send({ type: DESKTOP_EVENTS.notice, message: STORE_NOTICES.state })
      },
    })
    const configFile = join(userData, CONFIG_FILE)
    const loadedConfig = await loadConfig({
      fs: stateFs,
      file: configFile,
      now: Date.now,
      server: fixedServer,
      newId: randomUUID,
    })
    // Written on the next tick after a change.
    const config = createJsonStore({
      fs: stateFs,
      file: configFile,
      initial: loadedConfig.config,
      timers,
      debounceMs: 0,
      onError: (error) => {
        reportError({ text: 'raven player could not save its settings.', error })
        send({ type: DESKTOP_EVENTS.notice, message: STORE_NOTICES.config })
      },
    })
    const theServer = () => serverOf(config.read())
    const serverOfId = (serverId: string) => serverById({ config: config.read(), serverId })
    // Nothing opens an older raven player's server sessions any more, so none of the folders
    // it removes is open; the removals go on while the window opens.
    const formerSessions = await clearFormerPartitions({
      dir: join(userData, PARTITIONS_DIR),
      fs: {
        readdir: (path) => readdir(path),
        remove: (path) => rm(path, { recursive: true, force: true }),
      },
      timers,
      warn,
    })
    formerSessions.removing.catch((error: unknown) => {
      warn(`raven player could not clear its old server sessions: ${errorText(error)}`)
    })
    rm(join(userData, FORMER_ACCOUNTS_DIR), { recursive: true, force: true }).catch(
      (error: unknown) => {
        warn(`raven player could not clear its old sign-ins: ${errorText(error)}`)
      },
    )
    const grants = createGrants({ fs: { realpath, stat }, newId: randomUUID })
    // The page enters the library PIN, so main's own calls carry the unlock cookie it holds.
    const pageUnlock = createPageUnlock({ cookies: session.defaultSession.cookies, warn })
    // The page's sign in: a sign out ends what main holds on the account's behalf (`accessEnds`),
    // and a change of account reaches what keeps data per account (`accountSwitches`).
    const accessEnds = createServerSignal()
    const accountSwitches = createServerSignal()
    const account = createPageAccount({
      onSwitched: () => {
        log.info(account.accountId() === null ? 'signed out of raven' : 'signed in to raven')
        accountSwitches.notify({ serverId: theServer().id })
      },
      onEnded: () => accessEnds.notify({ serverId: theServer().id }),
    })
    const accountIdOf = ({ serverId }: { serverId: string }): string | null =>
      serverId === theServer().id ? account.accountId() : null
    const serverCalls = createServerCalls({
      serverOf: serverOfId,
      fetch: fetchThrough((url, init) => net.fetch(url, init)),
      authorize: ({ serverId }) => (serverId === theServer().id ? account.accessToken() : null),
      unlockOf: ({ serverId }) =>
        serverId === theServer().id ? pageUnlock() : Promise.resolve(null),
      warn,
    })
    const accountTickets = createAccountTickets({
      calls: serverCalls,
      isSignedIn: (input) => accountIdOf(input) !== null,
      now: Date.now,
    })
    const relay = createMediaRelay({
      listen: listenOnLoopback({ createServer: (handler) => createServer(handler), warn }),
      fetchUpstream: fetchRelayed,
      tickets: accountTickets,
      newSecret: (bytes) => randomBytes(bytes).toString('base64url'),
      warn,
    })
    // A sign out: the title stops being relayed. A ticket is the account's that minted it, so
    // another account mints its own.
    accessEnds.listen(({ serverId }) => relay.closeServer(serverId))
    accountSwitches.listen(({ serverId }) => accountTickets.forget(serverId))
    const sources = createServerSources({
      serverOf: serverOfId,
      calls: serverCalls,
      tickets: accountTickets,
      relay,
      warn,
    })
    // Grants hold real paths, so the downloads are named from the real folder too: a profile
    // reached through a link (a temporary folder on macOS) would otherwise match none of them.
    const downloadsUserData = await realpath(userData).catch(() => userData)
    const downloadsFile = join(userData, DOWNLOADS_FILE)
    const loadedDownloads = await loadDownloads({ fs: stateFs, file: downloadsFile, now: Date.now })
    const downloadsStore = createJsonStore({
      fs: stateFs,
      file: downloadsFile,
      initial: loadedDownloads.state,
      timers,
      debounceMs: DOWNLOADS_DEBOUNCE_MS,
      onError: (error) => {
        reportError({ text: 'raven player could not save its downloads.', error })
        send({ type: DESKTOP_EVENTS.notice, message: STORE_NOTICES.downloads })
      },
    })
    // Every download filed under the one server, its folders moved first, and saved before the
    // config that says which servers were adopted, so a launch cut short does it all again.
    const settled = await settleDownloads({
      state: loadedDownloads.state,
      serverId: theServer().id,
      adopted: loadedConfig.adopted,
      userData: downloadsUserData,
      fs: {
        mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
        rename: ({ from, to }) => rename(from, to),
        exists: (path) =>
          stat(path).then(
            () => true,
            () => false,
          ),
      },
      warn,
    })
    downloadsStore.update(() => settled)
    await downloadsStore.flush()
    // The server keeps its id from launch to launch only once the config holding it is saved.
    if (loadedConfig.isChanged) config.update((current) => ({ ...current }))
    // The ticket in the URL is the file's only key, so a download sends no cookie.
    const fetchDownload: StreamFetch = ({ url, headers, signal }) =>
      fetchBare({ url, init: { headers, signal } })
    const downloads = createDownloadService({
      store: downloadsStore,
      config,
      calls: serverCalls,
      userData: downloadsUserData,
      space: {
        mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
        statfs: (path) => statfs(path),
      },
      timers,
      now: Date.now,
      newId: randomUUID,
      send,
      warn,
      access: createMediaAccess({
        calls: serverCalls,
        serverOf: serverOfId,
        probe: fetchProbe,
        probeClock: () => performance.now(),
        now: Date.now,
        timers,
        tickets: accountTickets,
        warn,
      }),
      fetch: fetchDownload,
      fs: {
        mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
        rename: ({ from, to }) => rename(from, to),
        rm: (path) => rm(path, { recursive: true, force: true }),
        readdir: (path) => readdir(path),
        openPart,
        writeFile: ({ path, text }) => writeFile(path, text, 'utf8'),
        size: (path) =>
          stat(path).then(
            ({ size }) => size,
            (error: unknown) => {
              if (isMissingFile(error)) return 0
              throw error
            },
          ),
      },
      showItemInFolder: (path) => shell.showItemInFolder(path),
      ready: app.whenReady(),
      wasSetAside: loadedDownloads.wasSetAside,
      // A test hook shortens the five minutes; a packaged app never reads it.
      syncRetryMs: syncRetryFrom({ isPackaged: app.isPackaged, env: process.env }) ?? SYNC_RETRY_MS,
      grants,
      state: store,
      stat: (path) => stat(path),
      accountIdOf,
    })
    // Before the quit gate's own `before-quit`: each running file's bytes on disk are saved
    // while it is still downloading, then every fetch is aborted, so the gate's first flush
    // keeps them for the next launch. A run already renaming its finished video still marks
    // it ready, which the gate's second flush writes.
    app.once('before-quit', () => downloads.dispose())
    // A sign out: the downloads fetched with the account's ticket stop too.
    accessEnds.listen(({ serverId }) => downloads.accessEnded({ serverId }))
    // Another account signed in, or none: what the last one watched stays with it.
    accountSwitches.listen(({ serverId }) => downloads.accountSwitched({ serverId }))

    const updateSource = updateSourceFrom({ isPackaged: app.isPackaged, env: process.env })
    const updates = createUpdateService({
      config,
      check: () =>
        checkForUpdates({ fetch: fetchReleases, url: updateSource.url, current: app.getVersion() }),
      current: app.getVersion(),
      now: Date.now,
      openExternal: (url) => shell.openExternal(url),
      announce: (version) => send({ type: DESKTOP_EVENTS.updateAvailable, version }),
      warn,
    })
    // Once, on the first page's `ready`, so the page is listening for the announcement.
    const launchCheck = { isPending: updateSource.isLaunchCheckAllowed }
    const checkAtLaunch = (): void => {
      if (!launchCheck.isPending) return
      launchCheck.isPending = false
      updates.atLaunch().catch((error: unknown) => {
        warn(`raven player could not check for updates: ${errorText(error)}`)
      })
    }

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
        checkAtLaunch()
        const player = players.current
        if (player === null) return
        player.connect().catch((error: unknown) => {
          warn(`raven player could not hand the page its player: ${errorText(error)}`)
        })
      },
      onError: (error) => {
        reportError({ text: 'raven player failed to answer a request.', error })
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
      config,
      links: createLinkOpener({
        isServerOrigin: (origin) => namesServer({ server: fixedServer, origin }),
        serverId: () => theServer().id,
        downloads,
        warn,
      }),
      updates,
      downloads,
      account,
      titles: createServerTitles({
        server: theServer,
        downloads,
        tickets: accountTickets,
      }),
    })

    // mpv stops before the stores flush and before Electron tears the window down.
    const shutdown = createShutdown({
      engine: {
        isAlive: () => players.current !== null && players.current.engine.isAlive(),
        destroy: () =>
          players.current === null ? Promise.resolve() : players.current.engine.destroy(),
      },
      stores: [store, config, downloadsStore],
      writes: { hasPending: serverCalls.hasPendingWrites, settle: serverCalls.settleWrites },
      log,
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
        const end = () => {
          switch (ending) {
            case HARD_EXITS.kill:
              process.kill(process.pid, 'SIGKILL')
              return
            case HARD_EXITS.exit:
              app.exit(0)
              return
            default: {
              const unreachable: never = ending
              return unreachable
            }
          }
        }
        quitMark.ended()
        // Neither ending runs `will-quit`, so the quit mark is written here, for as long as
        // the log is given on a normal quit.
        endAfterLog({ log, wait: (ms) => sleep(ms), end }).catch(reportEndFailure)
      },
      wait: (ms) => sleep(ms),
    })
    // Both, because the page's last `savePosition` can land between them.
    app.on('before-quit', quitGate)
    app.on('will-quit', quitGate)

    await app.whenReady()
    // Packaged, the bundle's icon.icns is the Dock's; unpackaged, Electron's own would be.
    if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), `${APP_ICON}.png`))
    // `powerMonitor` answers only once the app is ready. A sleep stops the downloads where
    // they are, and the wake starts them again.
    powerMonitor.on('suspend', () => downloads.onSuspend())
    powerMonitor.on('resume', () => downloads.onResume())
    await startWebHost({ serverOrigin: fixedServer.origin })
    serveFiles({ grants })
    secureContents()
    answerRequests({ service, grants })

    const help = createHelpActions({
      folders: { logs: app.getPath('logs'), crashDumps: app.getPath('crashDumps') },
      mkdir: (path) => mkdir(path, { recursive: true, mode: 0o700 }),
      openPath: (path) => shell.openPath(path),
      writeClipboard: (text) => clipboard.writeText(text),
      diagnostics: readDiagnostics,
      notify: (message) => send({ type: DESKTOP_EVENTS.notice, message }),
      warn,
    })
    // The actions settle every failure themselves; this only keeps a surprise off the floor.
    const fromMenu = (action: () => Promise<void>) => () => {
      action().catch((error: unknown) => {
        reportError({ text: 'raven player could not finish a Help item.', error })
      })
    }

    // The menu's check always runs, switched off or not (Ruling 9).
    const checkFromMenu = createMenuCheck({
      updates,
      current: app.getVersion(),
      announce: (version) => send({ type: DESKTOP_EVENTS.updateAvailable, version }),
      show: async (options) => {
        const window = liveWindow()
        const { response } =
          window === null
            ? await dialog.showMessageBox(options)
            : await dialog.showMessageBox(window, options)
        return response
      },
    })

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
                  reportError({ text: 'raven player could not show the open dialog.', error })
                })
            },
            send,
            toggleDevTools,
            showLogs: fromMenu(help.showLogs),
            showCrashReports: fromMenu(help.showCrashReports),
            copyDiagnostics: fromMenu(help.copyDiagnostics),
            checkForUpdates: () => {
              checkFromMenu().catch((error: unknown) => {
                reportError({ text: 'raven player could not check for updates.', error })
              })
            },
          },
        }),
      ),
    )
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
    })

    const window = openWindow({ store })
    window.once('ready-to-show', () => {
      launch.isWindowReady = true
    })
    windows.current = window
    // A test hook shortens both periods; a packaged app never reads it (Ruling 13).
    const budgetWindow = budgetWindowFrom({ isPackaged: app.isPackaged, env: process.env })
    const budgets = createBudgets({
      metrics: () => app.getAppMetrics(),
      timers,
      mark,
      windowMs: budgetWindow ?? BUDGET_WINDOW_MS,
      sampleMs: budgetWindow ?? PLAYING_SAMPLE_MS,
    })
    players.current = attachPlayer({
      window,
      grants,
      config,
      sources,
      relay,
      marks,
      budgets,
      downloads,
      serverOfId,
    })
    // A quit holds the window open while it flushes, so no budget timer may fire meanwhile.
    app.once('before-quit', () => budgets.dispose())
    window.on('closed', () => {
      windows.current = null
      budgets.dispose()
    })
    return service
  }

  services.ready = createService()
  services.ready.catch((error: unknown) => {
    reportError({ text: 'raven player could not start.', error })
    endAfterLog({ log, wait: (ms) => sleep(ms), end: () => app.exit(1) }).catch(reportEndFailure)
  })

  // One window: closing it quits, which runs the quit gate.
  app.on('window-all-closed', () => app.quit())
}

/**
 * The web app, served from the loopback web host with `/api` passed on to the server. A
 * custom scheme cannot hold it: Chromium keeps no `document.cookie` there, where the web's
 * Supabase session lives. The port is fixed, so when another app holds it raven player says
 * so and quits rather than move the page to an origin with none of its sign-in or settings.
 */
const startWebHost = async ({ serverOrigin }: { serverOrigin: string }): Promise<void> => {
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
    dialog.showErrorBox('raven player could not open', webHostFailureText(error))
    throw error
  }
  log.info(`${WEB_HOST_READY} at ${PAGE_ORIGIN}, /api goes to ${serverOrigin}`)
}

const serveFiles = ({ grants }: { grants: Grants }): void => {
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

const openInBrowser = (url: string): void => {
  shell.openExternal(url).catch((error: unknown) => {
    warn(`raven player could not open a link in the browser. ${errorText(error)}`)
  })
}

const secureContents = (): void => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isPermissionAllowed(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    isPermissionAllowed(permission),
  )

  // A navigation, or a redirect on the way to one, stays on the page or goes to the browser.
  const keepOnPage = (event: { url: string; preventDefault: () => void }): void => {
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

const answerRequests = ({ service, grants }: { service: DesktopService; grants: Grants }) => {
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
    .then(() => log.info(`raven player loaded ${PAGE_ORIGIN}/`))
    .catch((error: unknown) => {
      reportError({ text: 'raven player could not load its page.', error })
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
  isPageUrl(window.webContents.getURL())

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
  sources,
  relay,
  marks,
  budgets,
  downloads,
  serverOfId,
}: {
  window: BrowserWindow
  grants: Grants
  config: ConfigStore
  sources: ReturnType<typeof createServerSources>
  serverOfId: (serverId: string) => ServerEntry | null
  relay: Pick<MediaRelay, 'closeAll'>
  marks: ReturnType<typeof createMarks>
  budgets: ReturnType<typeof createBudgets>
  downloads: Pick<DownloadService, 'sidecarsOf' | 'notePlaying'>
}) => {
  const mode = engineMode()
  // mpv's events arrive from the moment it opens; the service exists a moment later.
  const sink: { service: PlayerService | null } = { service: null }
  const servers = {
    resolve: async (source: Parameters<typeof sources.resolve>[0]) => {
      const resolved = await sources.resolve(source)
      const server = serverOfId(source.serverId)
      if (resolved.ok && server !== null) {
        log.info(
          openLine({
            kind: PLAYER_SOURCE_KINDS.server,
            serverName: server.name,
            mediaId: source.mediaId,
          }),
        )
      }
      return resolved
    },
  }
  const resolveFrom = resolveSourceWith({ grants, servers, sidecarsOf: downloads.sidecarsOf })
  // Told as each load begins, in the order the loads come: a server title that resolves
  // slowly must not clear a download loaded after it.
  const resolveSource: typeof resolveFrom = (source) => {
    downloads.notePlaying({
      fileId: source.kind === PLAYER_SOURCE_KINDS.file ? source.fileId : null,
    })
    return resolveFrom(source)
  }
  const sleepGuard = createSleepGuard({
    start: () => powerSaveBlocker.start('prevent-display-sleep'),
    stop: (id) => powerSaveBlocker.stop(id),
  })
  // The budgets read both halves of the activity, which arrive one callback at a time.
  let latest: PlayerActivity = { isPlaying: false, isShowing: false }
  const activity = createActivity({
    onPlaying: (isPlaying) => {
      sleepGuard.set(isPlaying)
      marks.playing(isPlaying)
      latest = { ...latest, isPlaying }
      budgets.report(latest)
    },
    onShowing: (isShowing) => {
      latest = { ...latest, isShowing }
      budgets.report(latest)
      if (!isShowing) downloads.notePlaying({ fileId: null })
      // The title is gone from the screen, so its relay secret is retired with it.
      if (!isShowing) relay.closeAll()
      if (window.isDestroyed()) return
      window.setBackgroundColor(isShowing ? CLEAR : NIGHT)
      // A page with no video shows the traffic lights, whatever the player last asked for.
      if (!isShowing) showWindowButtons({ window, isVisible: true })
    },
  })

  const surfaceFor = (kind: MpvSurface['kind']): MpvSurface =>
    kind === MPV_SURFACE_KINDS.window ? { kind, handle: window.getNativeWindowHandle() } : { kind }

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
        resolveSource,
        explain: sources.explain,
        refusedAccount: sources.refusedAccount,
        canChooseAo: mode === ENGINE_MODES.window,
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

  const openLogged = async (surface: MpvSurface): Promise<NativeEngine> => {
    const opened = await openNative(surface)
    const ffmpeg = await opened.mpv
      .read({ name: MPV_PROPERTIES.ffmpegVersion })
      .catch(() => 'unknown')
    log.info(`video engine ready: ${opened.mpv.version}, FFmpeg ${ffmpeg}`)
    return opened
  }

  // Why there is no engine, for Copy Diagnostics. The message the engine fell back with, not
  // the error behind it, which the log keeps: a failed dlopen names the addon's path.
  let engineNote: string | null = null
  const engine = createEngineSlot<NativeEngine>({
    open: async () => {
      try {
        const opened = await openEngine({
          mode,
          surfaceFor,
          open: openLogged,
          warn: (message) => warn(`raven player could not open its video engine: ${message}`),
        })
        if (opened.status === ENGINE_STATUSES.unavailable) engineNote = opened.message
        return opened
      } catch (error) {
        engineNote = ENGINE_MESSAGES.unavailable
        throw error
      }
    },
    destroyOf: ({ mpv, service }) => {
      service.dispose()
      return mpv.destroy()
    },
    watch: ({ engine: opened, onDied }) =>
      watchService({
        engine: opened,
        onDied: () => {
          engineNote = ENGINE_MESSAGES.unavailable
          onDied()
        },
      }),
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
      window.webContents.postMessage(IPC_CHANNELS.player, connection, ports)
    },
    warn,
    timers,
  })

  const startEngine = () => {
    engine.get().catch((error: unknown) => {
      warn(`raven player could not open its video engine: ${errorText(error)}`)
    })
  }
  // Whichever comes first of this and the page's `ready` (through the connector).
  window.once('ready-to-show', startEngine)

  const followDisplay = () => {
    const current = engine.current()
    if (current === null) return
    applyDisplayTo({ window, engine: current }).catch((error: unknown) => {
      warn(`raven player could not follow the display: ${errorText(error)}`)
    })
  }
  window.on('moved', followDisplay)
  window.on('enter-full-screen', followDisplay)
  window.on('leave-full-screen', followDisplay)
  screen.on('display-added', followDisplay)
  screen.on('display-removed', followDisplay)
  screen.on('display-metrics-changed', followDisplay)

  // A new page load drops the port the last page's `ready` is still waiting on the engine for.
  // Handed over late, it would reach the new page, which keeps the first port it gets, and
  // the new page's own `ready` would then close it under it.
  window.webContents.on('did-navigate', () => {
    connector.disconnect()
  })

  // A crashed page holds no port; stop what it was playing until its reload asks again, and put
  // the window back for a page with no video even when the service had nothing left to stop.
  window.webContents.on('render-process-gone', () => {
    connector.disconnect()
    activity.hide()
  })

  // Each page load starts with no video, whatever the last one left the window showing.
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
          case CLOSE_TIMEOUTS.quitApp:
            // The app's gate flushes the stores, then ends the process however it must.
            app.quit()
            return
          case CLOSE_TIMEOUTS.destroyWindow:
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

  return { engine, connect, engineNote: () => engineNote }
}

if (isPrimary) {
  log.info(
    `launch raven player ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'unpackaged'}), Electron ${process.versions.electron}, macOS ${process.getSystemVersion()}`,
  )
  startApp()
} else {
  // Another raven player is running; it receives this launch's files through `second-instance`.
  app.quit()
}
