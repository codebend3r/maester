import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  DESKTOP_EVENTS,
  DESKTOP_PLATFORMS,
  type DesktopEvent,
  type DesktopReply,
  FILE_SCHEME,
  PICTURE_SCHEME,
  VIDEO_EXTENSIONS,
  LINK_SCHEME,
} from '@raven/core'
import { desktopPlatformFor, SYSTEM_NAMES } from '@/shared/platform'
import { nativeTargetOf } from '@raven/mpv'
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  Menu,
  type OpenDialogOptions,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { APP_ICON } from '@/build/forgeOptions'
import { createPageAccount } from '@/main/accounts/pageAccount'
import { createAccountSignal } from '@/main/accounts/accountSignal'
import { openAppDownloads } from '@/main/appDownloads'
import { createAppLog } from '@/main/appLog'
import { openAppStores } from '@/main/appStores'
import {
  answerRequests,
  openWindow,
  PRODUCT_NAME,
  secureContents,
  serveFiles,
  servePictures,
  showWindowButtons,
  startWebHost,
} from '@/main/appWindow'
import {
  BUDGET_WINDOW_MS,
  budgetWindowFrom,
  createBudgets,
  PLAYING_SAMPLE_MS,
} from '@/main/budgets'
import { namesServer, setOutput } from '@/main/desktopConfig'
import { createDesktopService, type DesktopService } from '@/main/desktopService'
import { diagnosticsText, readEngineDiagnostics, unavailableReason } from '@/main/diagnostics'
import { createGrants } from '@/main/grants'
import { createHelpActions } from '@/main/help'
import { errorText } from '@/main/log/errorText'
import { logsDirFor } from '@/main/log/opens'
import { menuTemplate } from '@/main/menu'
import { fetchReleases } from '@/main/netFetches'
import { removeTree } from '@/main/nodeFs'
import { createOpenBatch, eventForOpen, launchPaths, linksFromArgv } from '@/main/openBatch'
import { ENGINE_STATUSES } from '@/main/player/engine'
import { createMarks } from '@/main/player/marks'
import { attachMusicPlayer, type MusicPlayer } from '@/main/player/audioPlayer'
import {
  type ClosableEngine,
  closeWindowAfterEngines,
  destroyEngines,
  isAnyEngineAlive,
} from '@/main/player/windowClose'
import { readDevices } from '@/main/player/outputOptions'
import { attachPlayer, type NativeEngine, type WindowPlayer } from '@/main/player/windowPlayer'
import { engineMode } from '@/main/player/windowEngine'
import { createQuitGate } from '@/main/quitGate'
import { createQuitMark } from '@/main/quitMark'
import { createLinkOpener } from '@/main/servers/linkOpener'
import { clearFormerPartitions, PARTITIONS_DIR } from '@/main/servers/formerSessions'
import { createPageUnlock } from '@/main/servers/pageUnlock'
import { createServerPlumbing } from '@/main/servers/serverPlumbing'
import { createServerTitles } from '@/main/servers/serverTitles'
import {
  createShutdown,
  endAfterLog,
  HARD_EXITS,
  hardExitFor,
  QUIT_FLUSH_MS,
} from '@/main/shutdown'
import { squirrelStepFor, takeSquirrelStep } from '@/main/squirrel'
import { createNodeTimers } from '@/main/timers'
import { createMenuCheck, createUpdateService, updateSourceFrom } from '@/main/updateService'
import { checkForUpdates } from '@/main/updates'
import { fixedServerFrom, linkOriginsFrom, serverOriginFrom } from '@/main/origins'
import { controlWindow, createWindowResizer } from '@/main/windowChrome'
import { IPC_CHANNELS } from '@/shared/hostNames'

const launchedAt = performance.now()

const USER_DATA_HOOK = 'RAVEN_DESKTOP_USER_DATA'
/** Where an older Raven kept its own sign-ins, encrypted: the page signs in now. */
const FORMER_ACCOUNTS_DIR = 'accounts'

// Finder sends one `open-file` per file; this gathers a multi-file open into one batch.
const OPEN_BATCH_MS = 100

const platform = desktopPlatformFor({ platform: process.platform })
/*
 * Squirrel's installer runs Raven on each install event and waits for it to exit, so such a
 * launch does its step and quits before anything starts.
 */
const isLaunch = takeSquirrelStep({
  step: squirrelStepFor({ platform, argv: process.argv, execPath: process.execPath }),
  run: ({ command, args, done }) => {
    spawn(command, args, { detached: true, stdio: 'ignore' }).on('close', done).on('error', done)
  },
  quit: () => app.quit(),
})

const timers = createNodeTimers()
const nativeTarget = nativeTargetOf({ platform: process.platform, arch: process.arch })

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
app.setAppLogsPath(
  logsDirFor({
    platform,
    home: app.getPath('home'),
    userData,
    hasUserDataOverride: userDataOverride !== null,
  }),
)

// A second instance hands its files to the first and quits.
const isPrimary = isLaunch && app.requestSingleInstanceLock()

/*
 * Music plays in mpv, not in the page, so Chromium must not answer the media keys or hold
 * Now Playing for a page's media: the addon owns both (the audio spec's Now Playing spike).
 */
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

const appLog = createAppLog({
  isPrimary,
  isPackaged: app.isPackaged,
  dir: app.getPath('logs'),
  timers,
})
const { log, warn, reportError, mark } = appLog

// The Help actions settle every failure themselves; this only keeps a surprise off the floor.
const fromMenu = (action: () => Promise<void>) => () => {
  action().catch((error: unknown) => {
    reportError({ text: 'Raven could not finish a Help item.', error })
  })
}

const reportEndFailure = (error: unknown): void => {
  console.error('Raven could not end.', error)
}

const startApp = (): void => {
  app.enableSandbox()
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_SCHEME,
      /*
       * standard and secure: a media source the secure page may load; stream: `<video>` reads
       * the response as it arrives and asks for byte ranges. It does not bypass the CSP,
       * which names `raven-file:` in `media-src`.
       */
      privileges: { standard: true, secure: true, stream: true },
    },
    // A download's saved pictures, which the CSP names in `img-src`; an `<img>` reads each whole.
    { scheme: PICTURE_SCHEME, privileges: { standard: true, secure: true } },
  ])

  const quitMark = createQuitMark({ isEnabled: true, now: () => performance.now(), write: mark })
  app.on('before-quit', quitMark.started)
  /*
   * Not on `quit`, after which nothing waits for a write: ahead of the quit gate's own
   * `will-quit`, which then finds the mark in the log and holds the quit while it writes.
   * So `raven-quit-ms` ends before that last flush of the log, which it does not count.
   */
  app.on('will-quit', quitMark.ended)

  const marks = createMarks({
    isEnabled: true,
    now: () => performance.now(),
    write: mark,
    timers,
    histogram: () => monitorEventLoopDelay({ resolution: 10 }),
  })
  // A file opened before the window is ready is a cold "Open With", timed to its first frame.
  let isWindowReady = false

  /*
   * The server this build plays from, and the other origins its links may name it by. Each is
   * replaced by `bun build --define` with what the build was given.
   */
  const fixedServer = fixedServerFrom({
    origin: serverOriginFrom({
      isPackaged: app.isPackaged,
      built: process.env.RAVEN_DESKTOP_SERVER_ORIGIN,
      env: process.env,
      warn,
    }),
    linkOrigins: linkOriginsFrom({
      isPackaged: app.isPackaged,
      built: process.env.RAVEN_DESKTOP_LINK_ORIGINS,
      env: process.env,
      warn,
    }),
  })

  let currentWindow: BrowserWindow | null = null
  let windowPlayer: WindowPlayer | null = null
  let musicPlayer: MusicPlayer | null = null
  /** The window's engines as they stand: the video player's and the music engine's. */
  const engines = (): ClosableEngine[] => {
    const attached: (ClosableEngine | null)[] = [
      windowPlayer?.engine ?? null,
      musicPlayer?.engine ?? null,
    ]
    return attached.filter((engine): engine is ClosableEngine => engine !== null)
  }
  const currentEngine = (): NativeEngine | null => {
    const player = windowPlayer
    return player === null ? null : player.engine.current()
  }
  // Timer callbacks (the open batches) call this too, so a closing window must not throw.
  const send = (event: DesktopEvent): void => {
    const window = currentWindow
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return
    try {
      window.webContents.send(IPC_CHANNELS.event, event)
    } catch (error) {
      warn(`Raven could not reach its window. ${errorText(error)}`)
    }
  }
  const resizer = createWindowResizer()
  const liveWindow = (): BrowserWindow | null => {
    const window = currentWindow
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
    const player = windowPlayer
    const engine = currentEngine()
    return diagnosticsText({
      app: { version: app.getVersion(), isPackaged: app.isPackaged, arch: process.arch },
      system: { name: SYSTEM_NAMES[platform], version: process.getSystemVersion() },
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
                note: player?.engineNote() ?? null,
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

  /*
   * Resolves once the window is open. The batches deliver only after the page's `ready`,
   * which the window's page sends, so by then it has resolved.
   */
  let serviceReady: Promise<DesktopService> | null = null
  const openFromMain = async (paths: readonly string[]): Promise<void> => {
    const service = await serviceReady
    if (service === null) return
    announce(await service.openPaths(paths))
    reveal()
  }

  const fileBatch = createOpenBatch<string>({
    delayMs: OPEN_BATCH_MS,
    timers,
    deliver: (paths) => {
      openFromMain(paths).catch((error: unknown) => {
        reportError({ text: 'Raven could not open those files.', error })
      })
    },
  })
  // Shown first, so the page that answers a link is on a window the person can see.
  const openLinksFromMain = async (links: readonly string[]): Promise<void> => {
    const service = await serviceReady
    if (service === null) return
    reveal()
    announce(await service.openLinks(links))
  }

  // The opener acts on the first link of a burst and asks about one server at a time.
  const linkBatch = createOpenBatch<string>({
    delayMs: OPEN_BATCH_MS,
    timers,
    deliver: (links) => {
      openLinksFromMain(links).catch((error: unknown) => {
        reportError({ text: 'Raven could not open that link.', error })
      })
    },
  })

  app.on('second-instance', (_event, argv) => {
    reveal()
    launchPaths({ argv, isDefaultApp: process.defaultApp }).forEach(fileBatch.push)
    linksFromArgv(argv).forEach(linkBatch.push)
  })
  /*
   * Forge writes the scheme into macOS's Info.plist only; Windows learns it from the app. Only
   * packaged, so a development run never claims the person's links for itself.
   */
  if (platform === DESKTOP_PLATFORMS.windows && app.isPackaged) {
    app.setAsDefaultProtocolClient(LINK_SCHEME)
  }

  // Registered here so a cold launch from Finder or a link still reaches them.
  app.on('will-finish-launching', () => {
    app.on('open-file', (event, path) => {
      event.preventDefault()
      if (!isWindowReady) marks.opened()
      fileBatch.push(path)
    })
    app.on('open-url', (event, url) => {
      event.preventDefault()
      linkBatch.push(url)
    })
  })
  launchPaths({ argv: process.argv, isDefaultApp: process.defaultApp }).forEach(fileBatch.push)
  linksFromArgv(process.argv).forEach(linkBatch.push)

  const createService = async (): Promise<DesktopService> => {
    /*
     * Nothing opens an older Raven's server sessions any more, so none of the folders it removes
     * is open; their removal runs beside the stores' reads, and goes on while the window opens.
     */
    const [stores, formerSessions] = await Promise.all([
      openAppStores({
        userData,
        fixedServer,
        timers,
        onSaveFailed: ({ text, notice, error }) => {
          reportError({ text, error })
          send({ type: DESKTOP_EVENTS.notice, message: notice })
        },
        warn,
      }),
      clearFormerPartitions({
        dir: join(userData, PARTITIONS_DIR),
        fs: { readdir: (path) => readdir(path), remove: removeTree },
        timers,
        warn,
      }),
    ])
    const { store, config, downloadsStore, server } = stores
    formerSessions.removing.catch((error: unknown) => {
      warn(`Raven could not clear its old server sessions: ${errorText(error)}`)
    })
    removeTree(join(userData, FORMER_ACCOUNTS_DIR)).catch((error: unknown) => {
      warn(`Raven could not clear its old sign-ins: ${errorText(error)}`)
    })
    const grants = createGrants({ fs: { realpath, stat }, newId: randomUUID })
    /*
     * The page's sign in: a sign out ends what main holds on the account's behalf (`accessEnds`),
     * and a change of account reaches what keeps data per account (`accountSwitches`).
     */
    const accessEnds = createAccountSignal()
    const accountSwitches = createAccountSignal()
    const account = createPageAccount({
      onSwitched: () => {
        log.info(account.accountId() === null ? 'signed out of raven' : 'signed in to raven')
        accountSwitches.notify()
      },
      onEnded: () => accessEnds.notify(),
    })
    const plumbing = createServerPlumbing({
      server,
      account,
      // The page enters the library PIN, so main's own calls carry the unlock cookie it holds.
      unlockOf: createPageUnlock({ cookies: () => session.defaultSession.cookies, warn }),
      accessEnds,
      accountSwitches,
      timers,
      warn,
    })
    const downloads = openAppDownloads({
      stores,
      plumbing,
      grants,
      accountIdOf: () => account.accountId(),
      accessEnds,
      accountSwitches,
      timers,
      send,
      warn,
    })

    const updateSource = updateSourceFrom({ isPackaged: app.isPackaged, env: process.env })
    const updates = createUpdateService({
      config,
      check: () =>
        checkForUpdates({
          fetch: fetchReleases,
          url: updateSource.url,
          current: app.getVersion(),
          target: nativeTarget,
        }),
      current: app.getVersion(),
      now: Date.now,
      openExternal: (url) => shell.openExternal(url),
      announce: (version) => send({ type: DESKTOP_EVENTS.updateAvailable, version }),
      warn,
    })
    // Once, on the first page's `ready`, so the page is listening for the announcement.
    let isLaunchCheckPending = updateSource.isLaunchCheckAllowed
    const checkAtLaunch = (): void => {
      if (!isLaunchCheckPending) return
      isLaunchCheckPending = false
      updates.atLaunch().catch((error: unknown) => {
        warn(`Raven could not check for updates: ${errorText(error)}`)
      })
    }

    const showOpenDialog = async (): Promise<string[]> => {
      const options = {
        filters: [{ name: 'Videos', extensions: [...VIDEO_EXTENSIONS] }],
        properties: ['openFile', 'multiSelections'],
      } satisfies OpenDialogOptions
      const window = currentWindow
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
      /*
       * The page sends `ready` once per mount; a reload sends it again, which the batches ignore
       * and which hands the new page a fresh player port (Ruling 12).
       */
      onReady: () => {
        fileBatch.ready()
        linkBatch.ready()
        checkAtLaunch()
        const player = windowPlayer
        if (player !== null) {
          player.connect().catch((error: unknown) => {
            warn(`Raven could not hand the page its player: ${errorText(error)}`)
          })
        }
        const music = musicPlayer
        if (music === null) return
        music.connect().catch((error: unknown) => {
          warn(`Raven could not hand the page its music engine: ${errorText(error)}`)
        })
      },
      onError: (error) => {
        reportError({ text: 'Raven failed to answer a request.', error })
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
          const applyVideo = async (): Promise<void> => {
            if (engine === null) return
            await engine.service.applyOutput({ output, devices: await readDevices(engine.mpv) })
          }
          await Promise.all([
            applyVideo(),
            musicPlayer === null ? Promise.resolve() : musicPlayer.applyOutput(),
          ])
        },
      },
      setWindowButtons: (isVisible) => {
        const window = liveWindow()
        if (window === null) return
        showWindowButtons({ window, isVisible, platform })
      },
      controlWindow: (action) => {
        const window = liveWindow()
        if (window === null) return
        controlWindow({ window, action })
      },
      startWindowResize: ({ edge, at }) => {
        const window = liveWindow()
        if (window === null) return
        resizer.start({ window, edge, at })
      },
      moveWindowResize: ({ to }) => {
        const window = liveWindow()
        if (window === null) return
        resizer.move({ window, to })
      },
      links: createLinkOpener({
        isServerOrigin: (origin) => namesServer({ server: fixedServer, origin }),
        downloads,
        warn,
      }),
      updates,
      downloads,
      account,
      titles: createServerTitles({ serverId: server.id, downloads, tickets: plumbing.tickets }),
    })

    // mpv stops before the stores flush and before Electron tears the window down.
    const shutdown = createShutdown({
      engine: {
        isAlive: () => isAnyEngineAlive(engines()),
        destroy: () => destroyEngines(engines()),
      },
      stores: [store, config, downloadsStore],
      writes: { hasPending: plumbing.calls.hasPendingWrites, settle: plumbing.calls.settleWrites },
      log,
      warn,
      wait: (ms) => sleep(ms),
    })
    const quitGate = createQuitGate({
      isDirty: shutdown.isPending,
      flush: shutdown.settle,
      timeoutMs: QUIT_FLUSH_MS,
      quit: () => app.quit(),
      /*
       * Reached when the flush timed out or the stores are still dirty; see `hardExitFor`
       * for why a live mpv means killing the process, and what that costs.
       */
      exit: () => {
        const ending = hardExitFor({ isEngineAlive: isAnyEngineAlive(engines()) })
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
        /*
         * Neither ending runs `will-quit`, so the quit mark is written here, for as long as
         * the log is given on a normal quit.
         */
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
    /*
     * `powerMonitor` answers only once the app is ready. A sleep stops the downloads where
     * they are, and the wake starts them again.
     */
    powerMonitor.on('suspend', () => downloads.onSuspend())
    powerMonitor.on('resume', () => downloads.onResume())
    await startWebHost({ serverOrigin: fixedServer.origin, timers, appLog })
    serveFiles({ grants })
    servePictures({ pictures: { fileOf: downloads.pictureOf } })
    secureContents({ warn })
    answerRequests({ service, grants, appLog })

    const help = createHelpActions({
      folders: { logs: app.getPath('logs'), crashDumps: app.getPath('crashDumps') },
      mkdir: (path) => mkdir(path, { recursive: true, mode: 0o700 }),
      openPath: (path) => shell.openPath(path),
      writeClipboard: (text) => clipboard.writeText(text),
      diagnostics: readDiagnostics,
      notify: (message) => send({ type: DESKTOP_EVENTS.notice, message }),
      warn,
    })
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
          platform,
          actions: {
            openDialog: () => {
              service
                .openDialog()
                .then(announce)
                .catch((error: unknown) => {
                  reportError({ text: 'Raven could not show the open dialog.', error })
                })
            },
            send,
            toggleDevTools,
            showLogs: fromMenu(help.showLogs),
            showCrashReports: fromMenu(help.showCrashReports),
            copyDiagnostics: fromMenu(help.copyDiagnostics),
            checkForUpdates: () => {
              checkFromMenu().catch((error: unknown) => {
                reportError({ text: 'Raven could not check for updates.', error })
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

    const window = openWindow({ store, launchedAt, appLog, platform })
    window.once('ready-to-show', () => {
      isWindowReady = true
    })
    currentWindow = window
    // A test hook shortens both periods; a packaged app never reads it (Ruling 13).
    const budgetWindow = budgetWindowFrom({ isPackaged: app.isPackaged, env: process.env })
    const budgets = createBudgets({
      metrics: () => app.getAppMetrics(),
      timers,
      mark,
      windowMs: budgetWindow ?? BUDGET_WINDOW_MS,
      sampleMs: budgetWindow ?? PLAYING_SAMPLE_MS,
    })
    const music = attachMusicPlayer({
      window,
      config,
      sources: plumbing.music.sources,
      relay: plumbing.music.relay,
      downloads,
      timers,
      platform,
      nativeTarget,
      info: (message) => log.info(message),
      warn,
    })
    musicPlayer = music
    windowPlayer = attachPlayer({
      window,
      grants,
      config,
      sources: plumbing.video.sources,
      relay: plumbing.video.relay,
      marks,
      budgets,
      downloads,
      timers,
      platform,
      nativeTarget,
      info: (message) => log.info(message),
      warn,
    })
    closeWindowAfterEngines({ window, engines: [windowPlayer.engine, music.engine] })
    // A quit holds the window open while it flushes, so no budget timer may fire meanwhile.
    app.once('before-quit', () => budgets.dispose())
    window.on('closed', () => {
      currentWindow = null
      musicPlayer = null
      budgets.dispose()
    })
    return service
  }

  serviceReady = createService()
  serviceReady.catch((error: unknown) => {
    reportError({ text: 'Raven could not start.', error })
    endAfterLog({ log, wait: (ms) => sleep(ms), end: () => app.exit(1) }).catch(reportEndFailure)
  })

  // One window: closing it quits, which runs the quit gate.
  app.on('window-all-closed', () => app.quit())
}

if (isPrimary) {
  log.info(
    `launch Raven ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'unpackaged'}), Electron ${process.versions.electron}, ${SYSTEM_NAMES[platform]} ${process.getSystemVersion()}`,
  )
  startApp()
} else if (isLaunch) {
  // Another Raven is running; it receives this launch's files through `second-instance`.
  app.quit()
}
