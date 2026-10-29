import {
  type ChoosableImageKind,
  IMAGE_SOURCES,
  type ImageOption,
  ITEM_IMAGE_KINDS,
  type ItemImageOptions,
} from '@raven/core'
import { type ItemImagesRepository, STORED_IMAGE_SOURCES } from '@/metadata/itemImagesRepository'
import type { TmdbImages } from '@/metadata/tmdbShapes'

/** What TMDB offers for an item it was not asked about: a made-up one, or with no token. */
export const NO_TMDB_IMAGES: TmdbImages = { poster: [], backdrop: [], logo: [] }

type ImageOptionsOfProps = {
  itemId: number
  /** The library whose cards' pictures are being chosen. */
  libraryId: number
  stored: Pick<ItemImagesRepository, 'image' | 'imageFrom'>
  fetched: TmdbImages
}

/**
 * Edit images: every poster, backdrop and logo a movie or show could show,
 * the one beside the media first, then TMDB's, with the one `libraryId`
 * shows marked.
 */
export const imageOptionsOf = ({
  itemId,
  libraryId,
  stored,
  fetched,
}: ImageOptionsOfProps): ItemImageOptions => {
  const options = (kind: ChoosableImageKind): ImageOption[] => {
    const current = stored.image({ itemId, kind, libraryId })
    const local = stored.imageFrom({ itemId, kind, source: STORED_IMAGE_SOURCES.local })
    const own = stored.imageFrom({ itemId, kind, source: STORED_IMAGE_SOURCES.tmdb })
    const tmdb = fetched[kind]
    // TMDB's own choice is offered even when the images call left it out.
    const listed =
      own != null && !tmdb.some((image) => image.path === own)
        ? [{ path: own, width: null, height: null, language: null }, ...tmdb]
        : tmdb
    return [
      ...(local == null
        ? []
        : [
            {
              source: IMAGE_SOURCES.local,
              ref: local,
              width: null,
              height: null,
              language: null,
              current: current?.source === STORED_IMAGE_SOURCES.local,
            },
          ]),
      ...listed.map((image) => ({
        source: IMAGE_SOURCES.tmdb,
        ref: image.path,
        width: image.width,
        height: image.height,
        language: image.language,
        current: current?.source !== STORED_IMAGE_SOURCES.local && current?.ref === image.path,
      })),
    ]
  }
  return {
    poster: options(ITEM_IMAGE_KINDS.poster),
    backdrop: options(ITEM_IMAGE_KINDS.backdrop),
    logo: options(ITEM_IMAGE_KINDS.logo),
  }
}
