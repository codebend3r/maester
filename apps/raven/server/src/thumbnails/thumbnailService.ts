import { mkdirSync } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { THUMBNAIL_STATES } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { thumbnailArgs, thumbnailSeek } from '@/ffmpeg/args'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { MediaIndex } from '@/media/mediaIndex'
import { createTaskQueue } from '@/scanner/concurrency'

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.size > 0,
    () => false,
  )

type ThumbnailServiceRenderProps = {
  input: string
  seek: number
  tonemap: boolean
}

/**
 * Generates one JPEG per video in the background and caches it under
 * `<data>/thumbnails/<id>.jpg`. Scans never wait on it: the library shows
 * straight away and cards fill in as thumbnails land. Work that was queued
 * when the server stopped is picked up again on boot.
 */
@Injectable()
export class ThumbnailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ThumbnailService.name)
  private readonly queue
  private readonly dir: string

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
  ) {
    this.queue = createTaskQueue({ concurrency: config.thumbnailConcurrency })
    this.dir = join(config.dataDir, 'thumbnails')
    mkdirSync(this.dir, { recursive: true })
  }

  onApplicationBootstrap(): void {
    this.retryPending()
  }

  /** Queues every probed file still waiting on a thumbnail, such as one that timed out before. */
  retryPending(): void {
    this.index.pendingThumbnailIds().forEach((id) => this.enqueue(id))
  }

  pathFor(id: number): string {
    return join(this.dir, `${id}.jpg`)
  }

  enqueue(id: number): void {
    this.queue.push({ key: String(id), task: () => this.generate(id) })
  }

  /** Forget media that is gone: drop its queued work and its cached file. */
  async discard(ids: readonly number[]): Promise<void> {
    ids.forEach((id) => this.queue.cancel(String(id)))
    await Promise.all(ids.map((id) => rm(this.pathFor(id), { force: true })))
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  pending(): number {
    return this.queue.size()
  }

  private async render({ input, seek, tonemap }: ThumbnailServiceRenderProps): Promise<string> {
    // ffmpeg picks the image muxer from the extension, so the temp file keeps .jpg.
    const temp = join(
      this.dir,
      `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    )
    try {
      await this.ffmpeg.exec(
        thumbnailArgs({ input, output: temp, seek, width: this.config.thumbnailWidth, tonemap }),
      )
      if (!(await exists(temp))) throw new Error('ffmpeg wrote no frame')
      return temp
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  private async generate(id: number): Promise<void> {
    const file = this.index.fileOf(id)
    if (!file || file.thumbnail === THUMBNAIL_STATES.ready) return
    const tonemap = file.hdr && (await this.ffmpeg.canTonemap())
    const seek = thumbnailSeek(file.duration)
    try {
      // A duration that overstates the real stream can seek past the last
      // frame; the first frame beats no thumbnail at all.
      const temp = await this.render({ input: file.path, seek, tonemap }).catch((error: unknown) =>
        seek > 0 && !(error instanceof FfmpegTimeoutError)
          ? this.render({ input: file.path, seek: 0, tonemap })
          : Promise.reject(error),
      )
      // Written aside and renamed into place, so a half-written JPEG is never served.
      await rename(temp, this.pathFor(id))
      this.index.setThumbnail({ id, state: THUMBNAIL_STATES.ready })
    } catch (error) {
      // A slow share is not a broken file: leave it pending for the next scan.
      const retryLater = error instanceof FfmpegTimeoutError
      this.logger.warn(`No thumbnail for ${file.fileName}: ${errorMessage(error)}`)
      this.index.setThumbnail({ id, state: retryLater ? 'pending' : 'failed' })
    }
  }
}
