import { Inject, Injectable } from '@nestjs/common'
import type { Chapter, MediaMarkers } from '@raven/core'
import { parseChapters } from '@/ffmpeg/chapters'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'

/**
 * A file's intro, credits and chapters for the player. The scan's probe
 * stores the chapters and the markers their titles name; a file probed
 * before chapters were kept has them read on its first play, once, the way
 * `TracksService` reads tracks.
 */
@Injectable()
export class MarkersService {
  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) private readonly index: MediaIndex,
  ) {}

  async markersFor(file: MediaFile): Promise<MediaMarkers> {
    const chapters = this.index.storedChapters(file.id) ?? (await this.readChapters(file))
    return { ...this.index.storedMarkers(file.id), chapters }
  }

  private async readChapters(file: MediaFile): Promise<Chapter[]> {
    const chapters = parseChapters(await this.ffmpeg.probeJson(file.path))
    this.index.saveChapters({ id: file.id, chapters })
    return chapters
  }
}
