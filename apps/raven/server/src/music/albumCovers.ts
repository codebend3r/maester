import { join } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { ImageCache, type ImageWidth } from '@/metadata/imageCache'
import { firstImage, listFolder } from '@/metadata/localAssets'
import { MediaIndex } from '@/media/mediaIndex'
import { COVER_SOURCES, MusicRepository } from '@/music/musicRepository'

/** The pictures an album folder may hold as its cover, the first found winning. */
const COVER_STEMS = ['cover', 'folder', 'front'] as const

type AlbumCoversPathOfProps = {
  id: number
  version: string
  width: ImageWidth
}

/** An album's cover on disk, at the width asked, from wherever its library holds it. */
@Injectable()
export class AlbumCovers {
  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  /** The cover in an album folder: `cover.jpg`, `folder.jpg` or `front.jpg`; null for none. */
  async inFolder(folder: string): Promise<string | null> {
    const name = firstImage({ names: await listFolder(folder), stems: COVER_STEMS })
    return name === null ? null : join(folder, name)
  }

  /**
   * The scaled cover's path, when `version` is the album's current one;
   * null for another version, an album with no cover, or a cover whose
   * file is gone or will not decode.
   */
  async pathOf({ id, version, width }: AlbumCoversPathOfProps): Promise<string | null> {
    const cover = this.music.cover({ id, version })
    if (cover === null) return null
    switch (cover.source) {
      case COVER_SOURCES.embedded: {
        const file = this.index.fileOf(Number(cover.ref))
        return file === null ? null : this.images.album({ albumId: id, source: file.path, width })
      }
      case COVER_SOURCES.file:
        return this.images.album({ albumId: id, source: cover.ref, width })
      default: {
        const unknown: never = cover.source
        return unknown
      }
    }
  }
}
