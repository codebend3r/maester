import type { Transport } from '@/apiClient/transport'
import {
  BACKDROP_OWN_WIDTH,
  CDN_BACKDROP_WIDTHS,
  CDN_POSTER_WIDTHS,
  type ChoosableImageKind,
  IMAGE_SOURCES,
  type ImageOption,
  ITEM_IMAGE_KINDS,
  type ItemImageKind,
  LIBRARY_BACKDROP_TYPES,
  type LibraryBackdrop,
  type MediaItem,
  PICTURE_PARAMS,
  PICTURE_PATHS,
  POSTER_OWN_WIDTH,
  POSTER_WIDTHS,
  type PosterWidth,
  THUMBNAIL_STATES,
} from '@/contract'
import { toQueryString } from '@/query'
import type { SagaPicture } from '@/sagas'

type ItemPicturePathProps = {
  id: number
  kind: ItemImageKind
  version: string
}

/**
 * The capability address of an item's picture of `kind` at `version`,
 * which it changes with, so it can be cached for good, by anyone.
 */
const itemPicturePath = ({ id, kind, version }: ItemPicturePathProps): string =>
  PICTURE_PATHS.item
    .replace(`:${PICTURE_PARAMS.id}`, String(id))
    .replace(`:${PICTURE_PARAMS.kind}`, kind)
    .replace(`:${PICTURE_PARAMS.version}`, encodeURIComponent(version))

type ItemImageUrlProps = {
  id: number
  kind: ItemImageKind
  version: string | null
}

type PosterSrcSetProps = { id: number; version: string | null }

type BackdropSrcSetProps = { id: number; version: string | null }

type ReviewAvatarUrlProps = {
  reviewId: number
  avatarVersion: string | null
}

type PhotoUrlProps = {
  personId: number
  photoVersion: string | null
}

type AlbumCoverUrlProps = {
  albumId: number
  coverVersion: string | null
}

type AlbumCoverSrcSetProps = {
  albumId: number
  coverVersion: string | null
}

type AlbumCoverPathProps = { albumId: number; coverVersion: string }

/** The capability address of an album's cover at `coverVersion`, which it changes with. */
const albumCoverPath = ({ albumId, coverVersion }: AlbumCoverPathProps): string =>
  PICTURE_PATHS.album
    .replace(`:${PICTURE_PARAMS.id}`, String(albumId))
    .replace(`:${PICTURE_PARAMS.version}`, encodeURIComponent(coverVersion))

type ImageOptionUrlProps = {
  id: number
  kind: ChoosableImageKind
  option: ImageOption
}

type PictureCallsProps = {
  transport: Transport
  /** The path of an image CDN on the page's own site, or null to fetch pictures from the server. */
  pictureCdn: string | null
}

/**
 * The addresses of every picture: capability pictures through the image CDN
 * when there is one, which resizes them to the width asked and re-encodes
 * them at the edge, else straight from the server, which keeps a poster at
 * the fixed few `POSTER_WIDTHS`.
 */
export const pictureCalls = ({ transport: { url }, pictureCdn }: PictureCallsProps) => {
  type PictureAtProps = { path: string; width?: number }

  /** A capability picture at `path`, narrowed to `width` when one is given. */
  const pictureAt = ({ path, width }: PictureAtProps): string => {
    if (pictureCdn !== null) {
      const query: Record<string, string> =
        width === undefined ? { url: url(path) } : { url: url(path), w: String(width) }
      return `${pictureCdn}?${toQueryString(query)}`
    }
    return width === undefined ? url(path) : `${url(path)}?${toQueryString({ w: String(width) })}`
  }

  type PictureSrcSetProps = {
    path: string
    widths: readonly number[]
    own: number
  }

  /** `widths` as an `img`'s `srcset` of `path`, the widest, the picture's own, asked with no width. */
  const pictureSrcSet = ({ path, widths, own }: PictureSrcSetProps): string =>
    widths
      .map((width) => `${pictureAt(width === own ? { path } : { path, width })} ${width}w`)
      .join(', ')

  type ThumbnailAtProps = { id: number; version: number }

  /** A video's thumbnail at `version`, which it changes with, so it can be cached for good. */
  const thumbnailAt = ({ id, version }: ThumbnailAtProps): string =>
    url(`/api/media/${id}/thumbnail?v=${version}`)

  const itemImageAt = (picture: ItemPicturePathProps): string =>
    pictureAt({ path: itemPicturePath(picture) })

  const posterWidths: readonly number[] = pictureCdn === null ? POSTER_WIDTHS : CDN_POSTER_WIDTHS

  return {
    /** null until the server has generated one; versioned so it can be cached forever. */
    thumbnailUrl: (media: MediaItem): string | null =>
      media.thumbnail === THUMBNAIL_STATES.ready
        ? thumbnailAt({ id: media.id, version: media.thumbnailVersion })
        : null,

    /** An item's poster, backdrop or still; null when it has none. Versioned, so cached for good. */
    itemImageUrl: ({ id, kind, version }: ItemImageUrlProps): string | null =>
      version == null ? null : itemImageAt({ id, kind, version }),

    /**
     * An item's poster at each width it comes in, for an `img`'s `srcset`;
     * null when it has none. The widest is `itemImageUrl`'s own URL, so a
     * card that shows it and the item's page share one download.
     */
    posterSrcSet: ({ id, version }: PosterSrcSetProps): string | null =>
      version == null
        ? null
        : pictureSrcSet({
            path: itemPicturePath({ id, kind: ITEM_IMAGE_KINDS.poster, version }),
            widths: posterWidths,
            own: POSTER_OWN_WIDTH,
          }),

    /** The widths `posterSrcSet` lists, narrowest first: finer through an image CDN. */
    posterWidths,

    /**
     * An item's backdrop at each width an image CDN makes of it, for an
     * `img`'s `srcset` beside `itemImageUrl`'s; null with no CDN, where the
     * server keeps a backdrop at its own width alone, or with no backdrop.
     */
    backdropSrcSet: ({ id, version }: BackdropSrcSetProps): string | null =>
      version == null || pictureCdn === null
        ? null
        : pictureSrcSet({
            path: itemPicturePath({ id, kind: ITEM_IMAGE_KINDS.backdrop, version }),
            widths: CDN_BACKDROP_WIDTHS,
            own: BACKDROP_OWN_WIDTH,
          }),

    /** One of a saga's movies' backdrops; versioned, so cached for good. */
    sagaPictureUrl: (picture: SagaPicture): string =>
      itemImageAt({ id: picture.id, kind: ITEM_IMAGE_KINDS.backdrop, version: picture.version }),

    /** The picture behind a library's row on the Libraries page; versioned, so cached for good. */
    libraryBackdropUrl: (backdrop: LibraryBackdrop): string => {
      switch (backdrop.type) {
        case LIBRARY_BACKDROP_TYPES.item:
          return itemImageAt({
            id: backdrop.id,
            kind: ITEM_IMAGE_KINDS.backdrop,
            version: backdrop.version,
          })
        case LIBRARY_BACKDROP_TYPES.thumbnail:
          return thumbnailAt({ id: backdrop.id, version: backdrop.version })
        default: {
          const unknown: never = backdrop
          return unknown
        }
      }
    },

    /** A reviewer's avatar, when TMDB hosts it. */
    reviewAvatarUrl: ({ reviewId, avatarVersion }: ReviewAvatarUrlProps): string | null =>
      avatarVersion == null
        ? null
        : url(`/api/reviews/${reviewId}/avatar?${toQueryString({ v: avatarVersion })}`),

    /** A person's photo; null when TMDB has none. */
    photoUrl: ({ personId, photoVersion }: PhotoUrlProps): string | null =>
      photoVersion == null
        ? null
        : pictureAt({
            path: PICTURE_PATHS.photo
              .replace(`:${PICTURE_PARAMS.id}`, String(personId))
              .replace(`:${PICTURE_PARAMS.version}`, encodeURIComponent(photoVersion)),
          }),

    /** An album's cover at its own width; null while the album has none. Versioned, so cached for good. */
    albumCoverUrl: ({ albumId, coverVersion }: AlbumCoverUrlProps): string | null =>
      coverVersion == null ? null : pictureAt({ path: albumCoverPath({ albumId, coverVersion }) }),

    /** An album's cover at each width a poster comes in, for an `img`'s `srcset`; null while it has none. */
    albumCoverSrcSet: ({ albumId, coverVersion }: AlbumCoverSrcSetProps): string | null =>
      coverVersion == null
        ? null
        : pictureSrcSet({
            path: albumCoverPath({ albumId, coverVersion }),
            widths: posterWidths,
            own: POSTER_OWN_WIDTH,
          }),

    /** A Fix match result's poster, through the server's image cache. */
    candidatePosterUrl: (poster: string | null): string | null =>
      poster == null ? null : url(`/api/images/poster${poster}`),

    /**
     * A TMDB poster path at each width the server keeps, for an `img`'s `src`
     * and `srcset`; `src` is the middle width, for a browser with no `srcset`.
     * The widest is the URL with no width, as in `posterSrcSet`, so it is the
     * one `candidatePosterUrl` asks for and the browser keeps one copy.
     */
    tmdbPosterSources: (poster: string): { src: string; srcSet: string } => {
      const own = url(`/api/images/poster${poster}`)
      const at = (width: PosterWidth): string =>
        width === POSTER_OWN_WIDTH ? own : `${own}?${toQueryString({ w: String(width) })}`
      return {
        src: at(POSTER_WIDTHS[1]),
        srcSet: POSTER_WIDTHS.map((width) => `${at(width)} ${width}w`).join(', '),
      }
    },

    /** A picture Edit images offers, through the server's cache (TMDB's) or scaled (a local one). */
    imageOptionUrl: ({ id, kind, option }: ImageOptionUrlProps): string =>
      option.source === IMAGE_SOURCES.local
        ? url(`/api/items/${id}/images/${kind}/local`)
        : url(`/api/images/${kind}${option.ref}`),
  }
}
