import { stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import {
  DEVICE_DOWNLOAD_STATES,
  DEVICE_DOWNLOAD_VARIANTS,
  type DeviceDownload,
  type DeviceDownloadVariant,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import {
  deviceDownloadArgs,
  type FinishedMp4ArgsProps,
  progressSeconds,
} from '@/ffmpeg/deviceDownloadArgs'
import { FFMPEG_SIGNALS, FfmpegService, PROCESS_EVENTS } from '@/ffmpeg/ffmpegService'
import { sdrDownloadArgs, sdrPictureOf } from '@/ffmpeg/sdrDownloadArgs'
import { MediaIndex } from '@/media/mediaIndex'
import { type OutputCache, createOutputCache } from '@/media/outputCache'
import { createOnce } from '@/once'
import { type Gate, createGate } from '@/scanner/concurrency'

/** A conversion that writes no progress for this long is stuck on the share, and is given up. */
const STALL_MS = 5 * 60 * 1000

/** How much more than the original's size the disk must have free before a copy starts. */
const ROOM_MARGIN = 1.05

/** Progress stops short of done until the copy is renamed into place: faststart still moves the index. */
const MOST_PROGRESS = 0.99

const EXTENSION = 'mp4'

/** What each copy's file name ends with, after the version: the two sit side by side in the media's folder. */
const NAME_ENDINGS = {
  [DEVICE_DOWNLOAD_VARIANTS.copy]: EXTENSION,
  [DEVICE_DOWNLOAD_VARIANTS.sdr]: `sdr.${EXTENSION}`,
} as const satisfies Record<DeviceDownloadVariant, string>

/** What a device is told when its copy is not made: plain, and never a path or ffmpeg's own words. */
export const DEVICE_DOWNLOAD_FAILURES = {
  noRoom: 'The server has no room for a copy of this video right now.',
  failed: 'The server could not make a copy of this video this device can play.',
  dolbyVision:
    'This video is Dolby Vision only, and the server cannot convert it for a browser. It plays in the Raven apps.',
} as const

type Running = { progress: number; done: Promise<void> }

/** One video's file as the cache keys its copy. */
type DeviceDownloadSource = {
  mediaId: number
  /** The video's file, read only. */
  path: string
  /** The file's mtime as it is on disk, which names the copy made of it. */
  mtimeMs: number
  /** Which copy: the picture as it is, or encoded again as SDR for a browser. */
  variant: DeviceDownloadVariant
}

type DeviceDownloadCachePrepareProps = DeviceDownloadSource & {
  /** How long the video plays, from the index; null when unknown. */
  durationSeconds: number | null
  videoCodec: string | null
}

/** Which version of which video a copy is of. */
type DeviceDownloadCacheVersionProps = Pick<DeviceDownloadSource, 'mediaId' | 'mtimeMs' | 'variant'>

/** A finished copy held open for one response: it is never evicted until `release`. */
type OpenedCopy = { path: string; release: () => void }

type DeviceDownloadCacheStartProps = DeviceDownloadCachePrepareProps & { target: string }

type DeviceDownloadCacheMakeProps = DeviceDownloadCacheStartProps & { job: Running }

type Probed = Awaited<ReturnType<FfmpegService['probeFile']>>

type DeviceDownloadCacheArgsOfProps = Pick<
  DeviceDownloadCacheMakeProps,
  'variant' | 'path' | 'videoCodec'
> & { probed: Probed }

/** One copy's ffmpeg arguments, for the temporary file it writes and the text subtitles it carries. */
type ArgsFor = (props: FinishedMp4ArgsProps) => string[]

type DeviceDownloadCacheConvertProps = {
  args: string[]
  durationSeconds: number | null
  job: Running
}

/** A failure the device is told about in the words given, rather than the plain one. */
class DeviceDownloadRefusal extends Error {
  constructor(readonly said: string) {
    super(said)
    this.name = 'DeviceDownloadRefusal'
  }
}

const preparing = (progress: number): DeviceDownload => ({
  state: DEVICE_DOWNLOAD_STATES.preparing,
  progress,
})

/** What every copy of this version of the file is named after. */
const versionOf = (mtimeMs: number): string => `${Math.round(mtimeMs)}.`

/**
 * MP4 copies of videos for devices whose player cannot open the original (an MKV on an
 * iPad), on disk as `device-downloads/<mediaId>/<mtimeMs>.mp4`, and their SDR copies for
 * browsers, which decode neither Dolby Vision nor every codec, beside them as
 * `<mtimeMs>.sdr.mp4`: one cache and one cap for both. A copy is made on the first
 * `prepare`, in the background, at most two at once, and its progress is answered to every
 * ask until it is done; a failed one is said once, and the ask after that tries again. A file
 * that changes gets a new copy, and the old one goes. Past `deviceDownloadCacheBytes` the
 * least recently served go first, by the output cache's sweep, run before each new copy too,
 * which also drops the folders of media no longer indexed. A copy a response is sending is
 * never evicted.
 */
@Injectable()
export class DeviceDownloadCache implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeviceDownloadCache.name)
  private readonly cache: OutputCache
  /**
   * Removes the folders of media no longer indexed, then the least recently served copies
   * until what is left, and `reserve` bytes more, fits the cap, keeping every copy being sent.
   */
  readonly sweep: OutputCache['sweep']
  private readonly running = new Map<string, Running>()
  private readonly failures = new Map<string, string>()
  // Asks that find no copy running share one look at the disk, so two at once start one copy.
  private readonly asks = createOnce<DeviceDownload>()
  // A conversion reads the whole file off the share; two at once keep a second device from waiting on the first.
  private readonly conversions: Gate = createGate({ limit: 2 })

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) index: Pick<MediaIndex, 'fileOf'>,
  ) {
    this.cache = createOutputCache({
      root: join(config.dataDir, 'device-downloads'),
      cap: config.deviceDownloadCacheBytes,
      index,
      what: 'the device downloads',
      logger: this.logger,
    })
    this.sweep = this.cache.sweep
  }

  onApplicationBootstrap(): void {
    this.cache.start()
  }

  async onModuleDestroy(): Promise<void> {
    this.cache.stop()
    await Promise.allSettled([...this.running.values()].map(({ done }) => done))
  }

  private targetOf({ mediaId, mtimeMs, variant }: DeviceDownloadCacheVersionProps): string {
    return this.cache.pathOf({ mediaId, name: `${versionOf(mtimeMs)}${NAME_ENDINGS[variant]}` })
  }

  /**
   * Where the copy of this version of the file stands, starting it when it is neither
   * cached nor running. A finished copy is marked as served now, so the sweep keeps it.
   */
  async prepare(props: DeviceDownloadCachePrepareProps): Promise<DeviceDownload> {
    const target = this.targetOf(props)
    const job = this.running.get(target)
    if (job) return preparing(job.progress)
    const failure = this.failures.get(target)
    if (failure !== undefined) {
      this.failures.delete(target)
      return { state: DEVICE_DOWNLOAD_STATES.failed, message: failure }
    }
    return this.asks.run({ key: target, make: () => this.lookUp({ ...props, target }) })
  }

  /** The copy on disk, ready and served now; without one, its run starts. */
  private async lookUp(props: DeviceDownloadCacheStartProps): Promise<DeviceDownload> {
    const { target } = props
    const existing = await stat(target).catch(() => null)
    if (existing !== null && existing.isFile()) {
      await this.cache.touch(target)
      return { state: DEVICE_DOWNLOAD_STATES.ready, bytes: existing.size }
    }
    this.start(props)
    return preparing(0)
  }

  private start(props: DeviceDownloadCacheStartProps): void {
    const { target, mediaId } = props
    const job: Running = { progress: 0, done: Promise.resolve() }
    job.done = this.make({ ...props, job })
      .catch((error: unknown) => {
        this.logger.warn(`Could not copy media ${mediaId} for a device: ${errorMessage(error)}`)
        this.failures.set(
          target,
          error instanceof DeviceDownloadRefusal ? error.said : DEVICE_DOWNLOAD_FAILURES.failed,
        )
      })
      .finally(() => this.running.delete(target))
    this.running.set(target, job)
  }

  /**
   * The finished copy of this version, held open until `release` so no sweep takes it
   * mid-send, and marked as served now; null while it is being made or when none is.
   */
  async open(props: DeviceDownloadCacheVersionProps): Promise<OpenedCopy | null> {
    const path = this.targetOf(props)
    if (this.running.has(path)) return null
    const info = await stat(path).catch(() => null)
    if (info === null || !info.isFile()) return null
    const release = this.cache.hold(path)
    await this.cache.touch(path).catch(() => undefined)
    return { path, release }
  }

  private async make({
    mediaId,
    path,
    mtimeMs,
    durationSeconds,
    videoCodec,
    variant,
    target,
    job,
  }: DeviceDownloadCacheMakeProps): Promise<void> {
    const probed = await this.ffmpeg.probeFile(path)
    // Settled before any room is made, so a copy that cannot be made evicts nothing.
    const argsFor = await this.argsOf({ variant, path, videoCodec, probed })
    const source = await stat(path)
    await this.sweep({ reserve: source.size })
    const room = await statfs(this.cache.root)
    if (room.bavail * room.bsize < source.size * ROOM_MARGIN) {
      throw new DeviceDownloadRefusal(DEVICE_DOWNLOAD_FAILURES.noRoom)
    }
    const textSubtitles = probed.tracks.subtitles.flatMap((track, at) =>
      track.supported ? [at] : [],
    )
    await this.cache.write({
      target,
      version: versionOf(mtimeMs),
      extension: EXTENSION,
      run: (output) =>
        this.conversions.run(async () => {
          try {
            await this.convert({ args: argsFor({ output, textSubtitles }), durationSeconds, job })
          } catch (error) {
            // A subtitle track mov_text cannot hold is no reason to give up the picture and sound.
            if (textSubtitles.length === 0) throw error
            this.logger.warn(`Copying media ${mediaId} again without its subtitles`)
            job.progress = 0
            await this.convert({
              args: argsFor({ output, textSubtitles: [] }),
              durationSeconds,
              job,
            })
          }
        }),
    })
  }

  /**
   * How the copy asked for is made of this file. An SDR copy picks its filter here, and is
   * refused, in words for the viewer, when the picture is Dolby Vision profile 5, which no
   * filter this server runs reads.
   */
  private async argsOf({
    variant,
    path,
    videoCodec,
    probed: { probe, tracks, streams },
  }: DeviceDownloadCacheArgsOfProps): Promise<ArgsFor> {
    if (variant === DEVICE_DOWNLOAD_VARIANTS.copy) {
      return ({ output, textSubtitles }) =>
        deviceDownloadArgs({
          input: path,
          output,
          videoCodec,
          dolbyVision: streams.video?.dolbyVision ?? null,
          audio: tracks.audio,
          textSubtitles,
        })
    }
    if (probe.isDolbyVisionOnly)
      throw new DeviceDownloadRefusal(DEVICE_DOWNLOAD_FAILURES.dolbyVision)
    // The filter is asked about only for a picture that needs one.
    const canTonemap = probe.hdr && (await this.ffmpeg.canTonemap())
    const picture = sdrPictureOf({ isHdr: probe.hdr, canTonemap })
    return ({ output, textSubtitles }) =>
      sdrDownloadArgs({
        input: path,
        output,
        picture,
        audio: tracks.audio,
        defaultAudio: tracks.defaultAudio,
        textSubtitles,
      })
  }

  /** One ffmpeg run, its progress read into `job` as it goes, given up once it stalls. */
  private convert({ args, durationSeconds, job }: DeviceDownloadCacheConvertProps): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.ffmpeg.convert(args)
      const watch: { stall: NodeJS.Timeout | null } = { stall: null }
      const stalled = (): void => {
        child.kill(FFMPEG_SIGNALS.kill)
        reject(new Error(`ffmpeg wrote no progress for ${STALL_MS / 1000}s`))
      }
      const rearm = (): void => {
        if (watch.stall) clearTimeout(watch.stall)
        watch.stall = setTimeout(stalled, STALL_MS)
        watch.stall.unref()
      }
      rearm()
      child.stdout.on(PROCESS_EVENTS.data, (chunk: Buffer) => {
        rearm()
        const seconds = progressSeconds(chunk.toString())
        if (seconds === null || durationSeconds === null || durationSeconds <= 0) return
        job.progress = Math.min(MOST_PROGRESS, Math.max(job.progress, seconds / durationSeconds))
      })
      child.on(PROCESS_EVENTS.error, reject)
      child.on(PROCESS_EVENTS.close, (code, signal) => {
        if (watch.stall) clearTimeout(watch.stall)
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(`ffmpeg ended with ${code ?? signal ?? 'no code'}`))
      })
    })
  }
}
