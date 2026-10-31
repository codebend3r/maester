import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { ImageCache, type ImageWidth } from '@/metadata/imageCache'
import { firstImage, listFolder } from '@/metadata/localAssets'
import { MediaIndex } from '@/media/mediaIndex'
import { albumFolderOf } from '@/music/filing'
import { COVER_SOURCES, type AlbumCover, MusicRepository } from '@/music/musicRepository'

const COVER_STEMS = ['cover', 'folder', 'front', 'album', 'artwork', 'albumart'] as const

type AlbumCoversPathOfProps = { id: number; version: string; width: ImageWidth }
type AlbumCoversReadProps = { id: number; cover: AlbumCover; width: ImageWidth }
type AlbumCoversTryProps = { id: number; covers: readonly AlbumCover[]; width: ImageWidth }

@Injectable()
export class AlbumCovers {
  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  private async inFolderCandidates(folder: string): Promise<AlbumCover[]> {
    const names = await listFolder(folder)
    return COVER_STEMS.flatMap((stem) => {
      const name = firstImage({ names, stems: [stem] })
      return name === null ? [] : [{ source: COVER_SOURCES.file, ref: join(folder, name) }]
    })
  }

  async inFolder(folder: string): Promise<string | null> {
    return (await this.inFolderCandidates(folder))[0]?.ref ?? null
  }

  private async read({ id, cover, width }: AlbumCoversReadProps): Promise<string | null> {
    switch (cover.source) {
      case COVER_SOURCES.embedded: {
        const file = this.index.fileOf(Number(cover.ref))
        return file === null ? null : this.images.album({ albumId: id, source: file.path, width })
      }
      case COVER_SOURCES.file:
        return this.images.album({ albumId: id, source: cover.ref, width })
      case COVER_SOURCES.coverArtArchive: {
        const fetched = await this.images.coverArt(cover.ref)
        return fetched === null ? null : this.images.album({ albumId: id, source: fetched, width })
      }
      default: {
        const unknown: never = cover.source
        return unknown
      }
    }
  }

  private async tryCovers({ id, covers, width }: AlbumCoversTryProps): Promise<string | null> {
    const [cover, ...rest] = covers
    if (!cover) return null
    const result = await this.read({ id, cover, width })
    if (result === null) return this.tryCovers({ id, covers: rest, width })
    if (cover.source !== COVER_SOURCES.coverArtArchive) {
      const source =
        cover.source === COVER_SOURCES.file
          ? cover.ref
          : (this.index.fileOf(Number(cover.ref))?.path ?? '')
      const info = await stat(source).catch(() => null)
      const stamp = info === null ? '' : `${info.mtimeMs}:${info.size}`
      this.music.setCover({ id, cover: { ...cover, stamp } })
    }
    return result
  }

  /** A failed local image must not hide healthy artwork elsewhere in the album. */
  async pathOf({ id, version, width }: AlbumCoversPathOfProps): Promise<string | null> {
    const cover = this.music.cover({ id, version })
    if (cover === null) return null
    const selected = await this.read({ id, cover, width })
    if (selected !== null) return selected
    const files = this.music.coverFiles(id)
    const folders = [...new Set(files.flatMap(({ path }) => [albumFolderOf(path), dirname(path)]))]
    const local = (
      await Promise.all(folders.map((folder) => this.inFolderCandidates(folder)))
    ).flat()
    const embedded = files.map((file) => ({ source: COVER_SOURCES.embedded, ref: String(file.id) }))
    const mbid = this.music.album(id)?.mbid ?? null
    const archive = mbid === null ? [] : [{ source: COVER_SOURCES.coverArtArchive, ref: mbid }]
    const alternatives = [...local, ...embedded, ...archive].filter(
      (candidate) => candidate.source !== cover.source || candidate.ref !== cover.ref,
    )
    return this.tryCovers({ id, covers: alternatives, width })
  }
}
