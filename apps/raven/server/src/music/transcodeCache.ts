import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { AudioBitrate } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { audioTranscodeArgs } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MediaIndex } from '@/media/mediaIndex'
import { type OutputCache, createOutputCache } from '@/media/outputCache'
import { createOnce } from '@/once'
import { type Gate, createGate } from '@/scanner/concurrency'

const EXTENSION = 'm4a'

/** How much faster than it plays a track must encode before its run is given up. */
const ENCODE_SPEED = 4

/** The time a track of unknown length may take: long enough for an audiobook of many hours. */
const UNKNOWN_LENGTH_SECONDS = 4 * 60 * 60

type TranscodeTimeoutSecondsProps = { durationSeconds: number | null; baseSeconds: number }

/**
 * How long one transcode may run: ffmpeg's usual limit, or longer for a track
 * that would not encode inside it at a quarter of its length.
 */
export const transcodeTimeoutSeconds = ({
  durationSeconds,
  baseSeconds,
}: TranscodeTimeoutSecondsProps): number =>
  durationSeconds === null
    ? Math.max(baseSeconds, UNKNOWN_LENGTH_SECONDS)
    : Math.max(baseSeconds, Math.ceil(durationSeconds / ENCODE_SPEED))

type TranscodeCacheFileForProps = {
  mediaId: number
  /** The track's file, read only. */
  path: string
  /** The track's mtime as it is on disk, which names the version made of it. */
  mtimeMs: number
  /** How long the track plays, from the index; null when unknown. */
  durationSeconds: number | null
  kbps: AudioBitrate
}

/**
 * Tracks converted to AAC for offline downloads and cellular streaming, on
 * disk as `transcodes/<mediaId>/<mtimeMs>-<kbps>.m4a`. Each is made on first
 * ask and served from disk after; a file that changes gets new ones, and the
 * old go. Past `transcodeCacheBytes` the least recently served go first, by
 * the output cache's sweep, which also drops the folders of media no longer indexed.
 */
@Injectable()
export class TranscodeCache implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly cache: OutputCache
  /** Keeps the file at a path from eviction while a response sends it; call what it returns once done. */
  readonly hold: OutputCache['hold']
  readonly sweep: OutputCache['sweep']
  private readonly baseTimeoutSeconds: number
  private readonly working = createOnce<string>()
  // Encoding takes CPU the server shares with video transcodes, and a download asks for an album at once.
  private readonly encodes: Gate = createGate({ limit: 2 })

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) index: Pick<MediaIndex, 'fileOf'>,
  ) {
    this.cache = createOutputCache({
      root: join(config.dataDir, 'transcodes'),
      cap: config.transcodeCacheBytes,
      index,
      what: 'the transcodes',
      logger: new Logger(TranscodeCache.name),
    })
    this.hold = this.cache.hold
    this.sweep = this.cache.sweep
    this.baseTimeoutSeconds = config.ffmpegTimeoutSeconds
  }

  onApplicationBootstrap(): void {
    this.cache.start()
  }

  async onModuleDestroy(): Promise<void> {
    this.cache.stop()
    await this.working.settled()
  }

  /**
   * The track at `kbps`, made once and marked as served now, so the sweep
   * keeps it over files served longer ago. Rejects when ffmpeg cannot read it.
   */
  async fileFor({
    mediaId,
    path,
    mtimeMs,
    durationSeconds,
    kbps,
  }: TranscodeCacheFileForProps): Promise<string> {
    const version = `${Math.round(mtimeMs)}-`
    const target = this.cache.pathOf({ mediaId, name: `${version}${kbps}.${EXTENSION}` })
    const made = await this.working.run({
      key: target,
      make: async () => {
        const existing = await stat(target).catch(() => null)
        if (existing?.isFile()) return target
        const timeoutSeconds = transcodeTimeoutSeconds({
          durationSeconds,
          baseSeconds: this.baseTimeoutSeconds,
        })
        await this.cache.write({
          target,
          version,
          extension: EXTENSION,
          run: (temp) =>
            this.encodes.run(() =>
              this.ffmpeg.exec({
                args: audioTranscodeArgs({ input: path, output: temp, kbps }),
                timeoutSeconds,
              }),
            ),
        })
        return target
      },
    })
    await this.cache.touch(made)
    return made
  }
}
