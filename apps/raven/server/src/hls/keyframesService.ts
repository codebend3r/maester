import { Inject, Injectable, Logger } from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MediaIndex, type ProbeTarget } from '@/media/mediaIndex'

/**
 * A file's video keyframes in seconds, which the HLS remux plan cuts its
 * segments at. ffprobe reads the whole file for them, which over a share is
 * slow, so they are probed once and kept in the index until the file
 * changes. Askers of the same version of a file while a probe runs share it.
 */
@Injectable()
export class KeyframesService {
  private readonly logger = new Logger(KeyframesService.name)
  private readonly running = new Map<string, Promise<number[]>>()

  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) private readonly index: MediaIndex,
  ) {}

  async of({ id, path }: ProbeTarget): Promise<number[]> {
    const stored = this.index.storedKeyframes(id)
    if (stored) return stored
    // A probe is of one version of the file: one asked for after the file
    // changed is a new probe, and one begun before it saves nothing.
    const mtimeMs = this.index.fileOf(id)?.mtimeMs ?? null
    const key = `${id}:${mtimeMs}`
    const running = this.running.get(key)
    if (running) return running

    const work = this.probe({ id, path, mtimeMs })
    this.running.set(key, work)
    try {
      return await work
    } finally {
      this.running.delete(key)
    }
  }

  /** Starts the probe in the background, unless it is stored or running, for a play that may come soon. */
  warm(target: ProbeTarget): void {
    this.of(target).catch((error: unknown) =>
      this.logger.warn(
        `Could not read the keyframes of media ${target.id}: ${errorMessage(error)}`,
      ),
    )
  }

  private async probe({
    id,
    path,
    mtimeMs,
  }: ProbeTarget & { mtimeMs: number | null }): Promise<number[]> {
    const keyframes = await this.ffmpeg.probeKeyframes(path)
    // Nothing awaits between this check and the save.
    if (this.index.fileOf(id)?.mtimeMs === mtimeMs) this.index.saveKeyframes({ id, keyframes })
    return keyframes
  }
}
