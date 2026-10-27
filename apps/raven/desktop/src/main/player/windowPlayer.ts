import { setTimeout as sleep } from 'node:timers/promises'
import { PLAYER_SOURCE_KINDS } from '@raven/core'
import { MPV_PROPERTIES, MPV_SURFACE_KINDS, type Mpv, type MpvSurface, openMpv } from '@raven/mpv'
import {
  app,
  BrowserWindow,
  MessageChannelMain,
  type MessagePortMain,
  powerSaveBlocker,
  screen,
} from 'electron'
import { NIGHT, showWindowButtons } from '@/main/appWindow'
import type { ConfigStore, ServerEntry } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import type { Grants } from '@/main/grants'
import { errorText } from '@/main/log/errorText'
import { openLine } from '@/main/log/opens'
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
import { resolveSourceWith } from '@/main/player/loadTarget'
import type { createMarks } from '@/main/player/marks'
import { readDevices } from '@/main/player/outputOptions'
import type { PortLike } from '@/main/player/playerPort'
import {
  createPlayerService,
  type PlayerActivity,
  type PlayerService,
} from '@/main/player/playerService'
import { createSleepGuard } from '@/main/player/sleepGuard'
import { createQuitGate } from '@/main/quitGate'
import { isPageUrl } from '@/main/security'
import type { MediaRelay } from '@/main/servers/mediaRelay'
import type { createServerSources } from '@/main/servers/serverSources'
import { CLOSE_TIMEOUTS, closeTimeoutFor, DESTROY_MS } from '@/main/shutdown'
import type { Timers } from '@/main/stateStore'
import type { createBudgets } from '@/main/budgets'
import { IPC_CHANNELS } from '@/shared/hostNames'

export type NativeEngine = { mpv: Mpv; service: PlayerService }
export type WindowPlayer = ReturnType<typeof attachPlayer>

// A test hook too: an unpackaged run reads `RAVEN_DESKTOP_MPV` (`headless` or `off`).
export const engineMode = () => engineModeFrom({ isPackaged: app.isPackaged, env: process.env })

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

type DisplayOfProps = { window: BrowserWindow; mpv: Mpv }

/** The display the window is on, read for mpv; null once mpv is gone. */
const displayOf = ({ window, mpv }: DisplayOfProps) => {
  if (window.isDestroyed()) return null
  return displayReading({
    frequency: screen.getDisplayMatching(window.getBounds()).displayFrequency,
    display: () => mpv.display(),
  })
}

type ApplyDisplayToProps = {
  window: BrowserWindow
  engine: NativeEngine
}

const applyDisplayTo = async ({ window, engine }: ApplyDisplayToProps): Promise<void> => {
  const reading = displayOf({ window, mpv: engine.mpv })
  if (reading === null) return
  await engine.service.applyDisplay(reading)
}

type AttachPlayerProps = {
  window: BrowserWindow
  grants: Grants
  config: ConfigStore
  sources: ReturnType<typeof createServerSources>
  serverOfId: (serverId: string) => ServerEntry | null
  relay: Pick<MediaRelay, 'closeAll'>
  marks: ReturnType<typeof createMarks>
  budgets: ReturnType<typeof createBudgets>
  downloads: Pick<DownloadService, 'sidecarsOf' | 'notePlaying'>
  timers: Timers
  info: (message: string) => void
  warn: (message: string) => void
}

/**
 * One window's player: its engine (opened once, under the page), the port hand-over,
 * what playing does to the window and the display, and the close that waits for mpv.
 */
export const attachPlayer = ({
  window,
  grants,
  config,
  sources,
  relay,
  marks,
  budgets,
  downloads,
  serverOfId,
  timers,
  info,
  warn,
}: AttachPlayerProps) => {
  const mode = engineMode()
  // mpv's events arrive from the moment it opens; the service exists a moment later.
  const sink: { service: PlayerService | null } = { service: null }
  const servers = {
    resolve: async (source: Parameters<typeof sources.resolve>[0]) => {
      const resolved = await sources.resolve(source)
      const server = serverOfId(source.serverId)
      if (resolved.ok && server !== null) {
        info(
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
    info(`video engine ready: ${opened.mpv.version}, FFmpeg ${ffmpeg}`)
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
          warn: (message) => warn(`Raven could not open its video engine: ${message}`),
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
      warn(`Raven could not open its video engine: ${errorText(error)}`)
    })
  }
  // Whichever comes first of this and the page's `ready` (through the connector).
  window.once('ready-to-show', startEngine)

  const followDisplay = () => {
    const current = engine.current()
    if (current === null) return
    applyDisplayTo({ window, engine: current }).catch((error: unknown) => {
      warn(`Raven could not follow the display: ${errorText(error)}`)
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
