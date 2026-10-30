import { dirname } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { THUMBNAIL_STATES } from '@raven/core'
import { MediaIndex } from '@/media/mediaIndex'
import { AlbumCovers } from '@/music/albumCovers'
import { AudioReader } from '@/music/audioReader'
import { MusicRepository } from '@/music/musicRepository'

type MusicIndexerIndexProps = {
  id: number
  libraryId: number
  path: string
}

/**
 * Reads one audio file for the scanner and files it: the facts the index
 * keeps of every file, its one track, and its album and artists from its
 * tags. No frame is grabbed: a track's picture is its album's cover, read
 * from the first of its files that embeds one, else from its folder.
 */
@Injectable()
export class MusicIndexer {
  /**
   * Each album folder is read for a cover once, however many files it
   * holds: a scan of the real library would otherwise read 25,000 folders
   * over SMB. A cover dropped into a folder later is seen on restart.
   */
  private readonly folderCovers = new Map<string, Promise<string | null>>()

  constructor(
    @Inject(AudioReader) private readonly reader: AudioReader,
    @Inject(MediaIndex) private readonly mediaIndex: MediaIndex,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(AlbumCovers) private readonly covers: AlbumCovers,
  ) {}

  async index({ id, libraryId, path }: MusicIndexerIndexProps): Promise<void> {
    const { probe, tracks, tags, format, chapters } = await this.reader.read(path)
    const folderCover = tags.hasCover ? null : await this.folderCover(dirname(path))
    this.mediaIndex.saveProbe({ id, probe, tracks, chapters })
    this.music.record({ mediaId: id, libraryId, path, tags, format, folderCover })
    // No thumbnail will come, so nothing waits for one.
    this.mediaIndex.setThumbnail({ id, state: THUMBNAIL_STATES.failed })
  }

  private folderCover(folder: string): Promise<string | null> {
    const known = this.folderCovers.get(folder)
    if (known) return known
    const read = this.covers.inFolder(folder)
    this.folderCovers.set(folder, read)
    return read
  }
}
