import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { POSTER_WIDTHS } from '@raven/core'
import { ImageCache, type ImageWidth } from '@/metadata/imageCache'
import { firstImage, listFolder } from '@/metadata/localAssets'
import { MediaIndex } from '@/media/mediaIndex'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { albumFolderOf } from '@/music/filing'
import { COVER_SOURCES, type AlbumCover, MusicRepository } from '@/music/musicRepository'

/** Files tried for a picture of their own when an album's cover failed: each read is a probe over the network share, and an album's files embed one picture or none. */
const EMBEDDED_RETRIES = 3
const COVER_STEMS = ['cover', 'folder', 'front', 'album', 'artwork', 'albumart'] as const

type AlbumCoversPathOfProps = { id: number; version: string; width: ImageWidth }
type AlbumCoversReadProps = { id: number; cover: AlbumCover; width: ImageWidth }
type AlbumCoversTryProps = { id: number; covers: readonly AlbumCover[]; width: ImageWidth }

/** How long after the server starts the covers are made ahead, so the start itself is not slowed. */
const WARM_DELAY_MS = 20_000

/** Covers made at once: each is a fetch from the archive or a read over the network share, then a scale. */
const WARM_CONCURRENCY = 3

@Injectable()
export class AlbumCovers implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlbumCovers.name)
  private warming: NodeJS.Timeout | null = null

  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  onApplicationBootstrap(): void {
    this.warming = setTimeout(() => {
      this.warm().catch((error: unknown) =>
        this.logger.warn(`Could not make covers ahead: ${String(error)}`),
      )
    }, WARM_DELAY_MS)
    this.warming.unref()
  }

  onModuleDestroy(): void {
    if (this.warming) clearTimeout(this.warming)
  }

  /**
   * Makes every album's cover at each width the grids ask for, so the first
   * time a page lists them they are already on disk. One that cannot be made
   * is left for the request that wants it. How many albums were warmed.
   */
  async warm(): Promise<number> {
    const albums = this.music.coverVersions()
    const done = await mapWithConcurrency({
      items: albums,
      limit: WARM_CONCURRENCY,
      fn: async ({ id, version }) => {
        const paths = await Promise.all(
          POSTER_WIDTHS.map((width) => this.pathOf({ id, version, width })),
        )
        return paths.every((path) => path !== null)
      },
    })
    const warmed = done.filter(Boolean).length
    this.logger.log(`Made the covers of ${warmed} of ${albums.length} albums ahead of a request`)
    return warmed
  }

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
        const group = this.music.releaseGroupOf(id)
        const fetched =
          (await this.images.coverArt(cover.ref)) ??
          (group === null ? null : await this.images.releaseGroupCoverArt(group))
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
    const embedded = files
      .slice(0, EMBEDDED_RETRIES)
      .map((file) => ({ source: COVER_SOURCES.embedded, ref: String(file.id) }))
    const mbid = this.music.album(id)?.mbid ?? null
    const archive = mbid === null ? [] : [{ source: COVER_SOURCES.coverArtArchive, ref: mbid }]
    const alternatives = [...local, ...archive, ...embedded].filter(
      (candidate) => candidate.source !== cover.source || candidate.ref !== cover.ref,
    )
    return this.tryCovers({ id, covers: alternatives, width })
  }
}
