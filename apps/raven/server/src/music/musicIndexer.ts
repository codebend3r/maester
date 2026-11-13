import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { THUMBNAIL_STATES } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { MediaIndex } from '@/media/mediaIndex'
import { AlbumCovers } from '@/music/albumCovers'
import { AudioReader } from '@/music/audioReader'
import { albumFolderOf } from '@/music/filing'
import { MusicRepository } from '@/music/musicRepository'

type MusicIndexerIndexProps = {
  id: number
  libraryId: number
  path: string
}

/**
 * Reads one audio file for the scanner and files it: the facts the index
 * keeps of every file, its one track, and its album and artists from its
 * tags. No thumbnail is grabbed: artwork comes from its album folder,
 * else an embedded picture, with recovery handled by AlbumCovers.
 */
@Injectable()
export class MusicIndexer {
  /**
   * Each album folder is read for a cover once, however many files it
   * holds: a scan of the real library would otherwise read 25,000 folders
   * over SMB. A full scan clears these discoveries to find replaced artwork.
   */
  private readonly folderCovers = new Map<string, Promise<string | null>>()

  constructor(
    @Inject(AudioReader) private readonly reader: AudioReader,
    @Inject(MediaIndex) private readonly mediaIndex: MediaIndex,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(AlbumCovers) private readonly covers: AlbumCovers,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  resetFolderCovers(): void {
    this.folderCovers.clear()
  }

  /**
   * The file's tags and its folder's cover are read together, and what they
   * say is written in one transaction, so a file is never half filed. The
   * albums and artists it leaves empty are dropped by `MusicRepository.prune`, once a scan's
   * files are all read.
   */
  async index({ id, libraryId, path }: MusicIndexerIndexProps): Promise<void> {
    const [{ probe, tracks, tags, format, chapters }, folderCover] = await Promise.all([
      this.reader.read(path),
      this.coverBeside(path),
    ])
    const info = await stat(folderCover ?? path).catch(() => null)
    const coverStamp = info === null ? '' : `${info.mtimeMs}:${info.size}`
    this.database.db.transaction(() => {
      this.mediaIndex.saveProbe({ id, probe, tracks, chapters })
      this.music.record({ mediaId: id, libraryId, path, tags, format, folderCover, coverStamp })
      // No thumbnail will come, so nothing waits for one.
      this.mediaIndex.setThumbnail({ id, state: THUMBNAIL_STATES.failed })
    })()
  }

  /** The cover of the file's album folder, else of the folder it sits in, else none. */
  private async coverBeside(path: string): Promise<string | null> {
    return (await this.folderCover(albumFolderOf(path))) ?? (await this.folderCover(dirname(path)))
  }

  private folderCover(folder: string): Promise<string | null> {
    const known = this.folderCovers.get(folder)
    if (known) return known
    const read = this.covers.inFolder(folder)
    this.folderCovers.set(folder, read)
    return read
  }
}
