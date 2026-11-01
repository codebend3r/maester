import {
  type AudioCommand,
  type AudioEvent,
  type DesktopPlatform,
  isAudioRequest,
} from '@raven/core'
import { type Mpv, type NativeTarget, openMpv } from '@raven/mpv'
import { app, type BrowserWindow, powerSaveBlocker } from 'electron'
import type { ConfigStore } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import { type AudioService, createAudioService } from '@/main/player/audioService'
import {
  addonPathFor,
  audioSurfaceFor,
  ENGINE_MODES,
  ENGINE_WORDS,
  engineOptionsFor,
  openEngine,
} from '@/main/player/engine'
import { createMusicResolve } from '@/main/player/musicSource'
import { readDevices } from '@/main/player/outputOptions'
import { createSleepGuard } from '@/main/player/sleepGuard'
import { attachWindowEngine, engineMode } from '@/main/player/windowEngine'
import type { MediaRelay } from '@/main/servers/mediaRelay'
import type { createServerSources } from '@/main/servers/serverSources'
import type { Timers } from '@/main/stateStore'
import { IPC_CHANNELS } from '@/shared/hostNames'

type MusicEngine = { mpv: Mpv; service: AudioService }
export type MusicPlayer = ReturnType<typeof attachMusicPlayer>

type AttachMusicPlayerProps = {
  window: BrowserWindow
  config: ConfigStore
  /** The music relay's sources: a track's resolve and the words for its failure. */
  sources: Pick<ReturnType<typeof createServerSources>, 'resolve' | 'explain'>
  relay: Pick<MediaRelay, 'close'>
  /** A track's ready download plays from its file, with no server. */
  downloads: Pick<DownloadService, 'trackPathOf'>
  serverId: () => string
  timers: Timers
  platform: DesktopPlatform
  nativeTarget: NativeTarget | null
  info: (message: string) => void
  warn: (message: string) => void
}

/**
 * The window's music engine: a second mpv with no video, opened under the page as the
 * video engine is and handed to each page load on its own port. Playing music keeps the
 * app from being suspended; the display may sleep.
 */
export const attachMusicPlayer = ({
  window,
  config,
  sources,
  relay,
  downloads,
  serverId,
  timers,
  platform,
  nativeTarget,
  info,
  warn,
}: AttachMusicPlayerProps) => {
  const mode = engineMode()
  const sink: { service: AudioService | null } = { service: null }
  const sleepGuard = createSleepGuard({
    start: () => powerSaveBlocker.start('prevent-app-suspension'),
    stop: (id) => powerSaveBlocker.stop(id),
  })

  const openNative = async (surface: ReturnType<typeof audioSurfaceFor>): Promise<MusicEngine> => {
    const mpv = await openMpv({
      surface,
      addonPath: addonPathFor({
        target: nativeTarget,
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
      const service = createAudioService({
        mpv,
        resolve: createMusicResolve({ sources, downloads, serverId }),
        explain: sources.explain,
        closeLoad: (target) => relay.close(target.relay.loadId),
        canChooseAo: mode === ENGINE_MODES.window,
        platform,
        onPlaying: (isPlaying) => sleepGuard.set(isPlaying),
        warn,
      })
      sink.service = service
      await service.applyOutput({ output: config.read().output, devices: await readDevices(mpv) })
      info(`music engine ready: ${mpv.version}`)
      return { mpv, service }
    } catch (error) {
      await mpv.destroy()
      throw error
    }
  }

  const attached = attachWindowEngine<AudioCommand, AudioEvent, MusicEngine>({
    window,
    channel: IPC_CHANNELS.audio,
    isRequest: isAudioRequest,
    words: ENGINE_WORDS.music,
    open: () =>
      openEngine({
        mode,
        surfaceFor: audioSurfaceFor,
        open: openNative,
        words: ENGINE_WORDS.music,
        warn: (message) => warn(`Raven could not open its music engine: ${message}`),
      }),
    destroyOf: ({ mpv, service }) => {
      service.dispose()
      return mpv.destroy()
    },
    onDied: () => {},
    timers,
    warn,
  })
  window.on('closed', () => sleepGuard.set(false))

  return {
    engine: attached.engine,
    connect: attached.connect,
    /** Sets the output on the open engine; nothing to do while there is none. */
    applyOutput: async () => {
      const current = attached.engine.current()
      if (current === null) return
      await current.service.applyOutput({
        output: config.read().output,
        devices: await readDevices(current.mpv),
      })
    },
  }
}
