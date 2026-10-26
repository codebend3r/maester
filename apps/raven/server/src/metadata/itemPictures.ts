import { dirname, join } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemImageKind,
  POSTER_WIDTHS,
  isItemImageKind,
  parseEpisodeName,
} from '@raven/core'
import type { FolderReader } from '@/metadata/folderReader'
import { ImageCache } from '@/metadata/imageCache'
import { ItemImagesRepository, STORED_IMAGE_SOURCES } from '@/metadata/itemImagesRepository'
import { episodeStill, movieAssets, seasonPoster, showAssets } from '@/metadata/localAssets'
import { type MatchFile, MatchFiles } from '@/metadata/matchFiles'
import { MetadataRepository, type StoredItem } from '@/metadata/metadataRepository'
import { showDirOf, stemOf } from '@/metadata/places'

type LocalImages = Partial<Record<ItemImageKind, string>>

type FoundProps = { kind: ItemImageKind; dir: string; name: string | null }

const found = ({ kind, dir, name }: FoundProps) => (name == null ? {} : { [kind]: join(dir, name) })

/** For each kind, the first file's picture that has one: the best file's folder wins. */
const firstOfEach = (pictures: readonly LocalImages[]): LocalImages =>
  Object.fromEntries(
    isItemImageKind.values.flatMap((kind) => {
      const ref = pictures.find((picture) => picture[kind] != null)?.[kind]
      return ref == null ? [] : [[kind, ref]]
    }),
  )

type ItemPicturesSyncLocalProps = {
  itemIds: readonly number[]
  folders: FolderReader
}

type ItemPicturesSyncOneProps = { itemId: number; folders: FolderReader }

type ItemPicturesBesideProps = {
  item: StoredItem
  file: MatchFile
  folders: FolderReader
}

/**
 * Item pictures raven looks after itself: the ones kept beside the media,
 * read from every file under an item so one folder never wipes what another
 * gives, the poster cache warmed for an item just matched, and the cache
 * swept of pictures nothing shows.
 */
@Injectable()
export class ItemPictures {
  /** The read of each item's pictures still running, so two for one item take turns. */
  private readonly syncing = new Map<number, Promise<void>>()

  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(MatchFiles) private readonly files: MatchFiles,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(ItemImagesRepository) private readonly stored: ItemImagesRepository,
  ) {}

  /**
   * Reads again the pictures beside the media for each item, from every file
   * linked to it or under it. Two reads for one item run one after the other,
   * so the later, which sees every file linked by then, is what stays.
   */
  async syncLocal({ itemIds, folders }: ItemPicturesSyncLocalProps): Promise<void> {
    await Promise.all(
      [...new Set(itemIds)].map((itemId) => {
        const previous = this.syncing.get(itemId) ?? Promise.resolve()
        const next = previous.then(() => this.syncOne({ itemId, folders }))
        this.syncing.set(itemId, next)
        return next.finally(() => {
          if (this.syncing.get(itemId) === next) this.syncing.delete(itemId)
        })
      }),
    )
  }

  private async syncOne({ itemId, folders }: ItemPicturesSyncOneProps) {
    const item = this.metadata.get(itemId)
    if (!item) return
    const files = this.files.under(itemId)
    const pictures = await Promise.all(files.map((file) => this.beside({ item, file, folders })))
    this.stored.setLocalImages({ itemId, images: firstOfEach(pictures) })
  }

  /** The pictures one file has beside it for `item`. */
  private async beside({ item, file, folders }: ItemPicturesBesideProps): Promise<LocalImages> {
    const dir = dirname(file.path)
    switch (item.type) {
      case ITEM_TYPES.movie: {
        const assets = movieAssets({
          names: await folders.names(dir),
          stem: stemOf(file.fileName),
          ownFolder: folders.ownFolder({ libraryId: file.libraryId, folder: file.folder }),
        })
        return {
          ...found({ kind: 'poster', dir, name: assets.poster }),
          ...found({ kind: 'backdrop', dir, name: assets.backdrop }),
        }
      }
      case ITEM_TYPES.show: {
        const showDir = showDirOf(file)
        const assets = showAssets(await folders.names(showDir))
        return {
          ...found({ kind: 'poster', dir: showDir, name: assets.poster }),
          ...found({ kind: 'backdrop', dir: showDir, name: assets.backdrop }),
        }
      }
      case ITEM_TYPES.season: {
        if (item.number == null) return {}
        // A season poster sits in the show's folder, or in the season's own.
        const showDir = showDirOf(file)
        const inShowFolder = seasonPoster({
          names: await folders.names(showDir),
          number: item.number,
        })
        if (inShowFolder != null) return found({ kind: 'poster', dir: showDir, name: inShowFolder })
        return found({
          kind: 'poster',
          dir,
          name: seasonPoster({ names: await folders.names(dir), number: item.number }),
        })
      }
      case ITEM_TYPES.episode: {
        // A file of two episodes keeps its still for the first.
        const [first] = parseEpisodeName(file).episodes
        if (item.number == null || first !== item.number) return {}
        return found({
          kind: 'still',
          dir,
          name: episodeStill({ names: await folders.names(dir), stem: stemOf(file.fileName) }),
        })
      }
      default: {
        const unknown: never = item.type
        throw new Error(`No pictures for an item of type ${String(unknown)}`)
      }
    }
  }

  /**
   * Fetches an item's poster into the cache as soon as it is matched, at
   * every width a card may ask for, so a library's first visit is quick
   * whatever the screen.
   */
  warmPoster(itemId: number): void {
    const image = this.stored.image({ itemId, kind: ITEM_IMAGE_KINDS.poster })
    if (!image) return
    POSTER_WIDTHS.forEach((width) => {
      const made =
        image.source === STORED_IMAGE_SOURCES.local
          ? this.images.local({ itemId, kind: ITEM_IMAGE_KINDS.poster, source: image.ref, width })
          : this.images.tmdb({ path: image.ref, width })
      void made.catch(() => null)
    })
  }

  /** Removes items and people nothing uses any more, then the pictures only they showed. */
  async clearUp(): Promise<void> {
    await this.images.sweep(this.metadata.clearUp())
  }
}
