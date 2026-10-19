import { Inject, Injectable } from '@nestjs/common'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MediaIndex, type ProbeTarget } from '@/media/mediaIndex'

/**
 * A file's video keyframes in seconds, which the HLS remux plan cuts its
 * segments at. ffprobe reads the whole file for them, which over a share is
 * slow, so they are probed once and kept in the index until the file
 * changes. Askers of the same file while a probe runs share it.
 */
@Injectable()
export class KeyframesService {
  private readonly running = new Map<number, Promise<number[]>>()

  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) private readonly index: MediaIndex,
  ) {}

  async of({ id, path }: ProbeTarget): Promise<number[]> {
    const stored = this.index.storedKeyframes(id)
    if (stored) return stored
    const running = this.running.get(id)
    if (running) return running

    const work = this.probe({ id, path })
    this.running.set(id, work)
    try {
      return await work
    } finally {
      this.running.delete(id)
    }
  }

  private async probe({ id, path }: ProbeTarget): Promise<number[]> {
    const keyframes = await this.ffmpeg.probeKeyframes(path)
    this.index.saveKeyframes({ id, keyframes })
    return keyframes
  }
}
