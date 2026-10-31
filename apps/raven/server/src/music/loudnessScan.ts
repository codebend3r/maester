import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { givePlaybackWay } from '@/ffmpeg/playbackYield'
import { ebur128Args, parseEbur128, trackGainOf } from '@/music/loudness'
import { type LoudTrack, LoudnessJobs } from '@/music/loudnessJobs'
import { transcodeTimeoutSeconds } from '@/music/transcodeCache'
import { createTaskQueue } from '@/scanner/concurrency'

type LoudnessScanScanTrackProps = LoudTrack

/**
 * Measures the loudness of the music tracks whose tags carry no ReplayGain,
 * an album at a time, with ffmpeg's EBU R128 meter, and gives each its
 * track gain and the album its album gain. It runs after a match pass and
 * on boot for whatever was waiting when the server stopped: the database
 * holds each track's state, so nothing is lost to a restart. Each track
 * waits while ffmpeg converts a file for someone watching, and ffmpeg runs
 * at the lowest CPU priority. `LOUDNESS_SCAN=off` turns it off.
 */
@Injectable()
export class LoudnessScan implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LoudnessScan.name)
  private readonly queue = createTaskQueue({ concurrency: 1 })
  private isStopping = false

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LoudnessJobs) private readonly jobs: LoudnessJobs,
    @Inject(FfmpegService)
    private readonly ffmpeg: Pick<FfmpegService, 'analyseErr' | 'isConverting'>,
  ) {}

  onApplicationBootstrap(): void {
    this.kick()
  }

  onModuleDestroy(): void {
    this.isStopping = true
  }

  /**
   * Queues every album with a track waiting for the scan, and every one
   * missing the gain its tracks' would give it. One already queued
   * is left as it is, and one running is queued again after it, for a track
   * filed under it meanwhile.
   */
  kick(): void {
    if (!this.config.shouldScanLoudness) return
    this.jobs
      .albumsDue()
      .forEach((albumId) =>
        this.queue.again({ key: `album:${albumId}`, task: () => this.scanAlbum(albumId) }),
      )
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  /** The album's waiting tracks one after another, then its gain from them all. */
  private async scanAlbum(albumId: number): Promise<void> {
    await this.jobs.tracksDue(albumId).reduce<Promise<void>>(async (previous, track) => {
      await previous
      await this.scanTrack(track)
    }, Promise.resolve())
    if (this.isStopping) return
    this.jobs.finishAlbum(albumId)
  }

  /**
   * One track: measured, or failed for good when ffmpeg cannot read it or
   * prints no summary. A run out of time is left waiting, as the share is
   * the likelier cause, and tried again by the next kick.
   */
  private async scanTrack({ mediaId, path, duration }: LoudnessScanScanTrackProps): Promise<void> {
    await givePlaybackWay({ ffmpeg: this.ffmpeg, isStopping: () => this.isStopping })
    if (this.isStopping) return
    try {
      const stderr = await this.ffmpeg.analyseErr({
        args: ebur128Args(path),
        timeoutSeconds: transcodeTimeoutSeconds({
          durationSeconds: duration,
          baseSeconds: this.config.ffmpegTimeoutSeconds,
        }),
      })
      const measured = parseEbur128(stderr)
      if (measured === null) {
        this.logger.warn(`No loudness summary for ${path}`)
        this.jobs.failed(mediaId)
        return
      }
      this.jobs.measured({ mediaId, measured: trackGainOf(measured) })
    } catch (error) {
      this.logger.warn(`Loudness scan failed for ${path}: ${errorMessage(error)}`)
      if (!(error instanceof FfmpegTimeoutError)) this.jobs.failed(mediaId)
    }
  }
}
