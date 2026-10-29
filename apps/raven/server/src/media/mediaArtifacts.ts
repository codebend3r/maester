import { Inject, Injectable } from '@nestjs/common'
import { HlsSessions } from '@/hls/hlsSessions'
import { FilePasses } from '@/media/filePasses'
import { MusicRepository } from '@/music/musicRepository'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/**
 * What raven keeps of a video beside its row: its thumbnail, its subtitles,
 * its tracks in memory, the HLS sessions playing it and the passes open on
 * its file; and of a track, the album and artists it was the last of.
 */
@Injectable()
export class MediaArtifacts {
  constructor(
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(HlsSessions) private readonly hlsSessions: HlsSessions,
    @Inject(FilePasses) private readonly filePasses: FilePasses,
    @Inject(MusicRepository) private readonly music: Pick<MusicRepository, 'prune'>,
  ) {}

  /**
   * Forgets all of it for media that is gone. Called once the rows are,
   * so a row never says its thumbnail is ready after the file went.
   */
  async discard(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    this.music.prune()
    this.tracks.forget(ids)
    ids.forEach((mediaId) => {
      this.hlsSessions.drop({ mediaId })
      this.filePasses.drop({ mediaId })
    })
    await Promise.all([this.thumbnails.discard(ids), this.subtitles.discard(ids)])
  }
}
