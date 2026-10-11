import { Inject, Injectable } from '@nestjs/common'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/** What raven keeps of a video beside its row: its thumbnail, its subtitles, its tracks in memory. */
@Injectable()
export class MediaArtifacts {
  constructor(
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(TracksService) private readonly tracks: TracksService,
  ) {}

  /**
   * Forgets all of it for media that is gone. Called once the rows are,
   * so a row never says its thumbnail is ready after the file went.
   */
  async discard(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    this.tracks.forget(ids)
    await Promise.all([this.thumbnails.discard(ids), this.subtitles.discard(ids)])
  }
}
