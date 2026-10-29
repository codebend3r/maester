import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

/** A logo is the title drawn as art, on a clear ground, for a movie's or show's page. */
export const ITEM_IMAGE_KINDS = {
  poster: 'poster',
  backdrop: 'backdrop',
  still: 'still',
  logo: 'logo',
} as const

export const isItemImageKind = oneOf(Object.values(ITEM_IMAGE_KINDS))

/** The pictures an item can have. */
export type ItemImageKind = Infer<typeof isItemImageKind>

/**
 * A poster's own width: what it is served at when no width is asked for, and
 * the widest it comes in. `posterSrcSet` lists it at the URL with no width,
 * and the server keeps a poster at it by default, so both read it here.
 */
export const POSTER_OWN_WIDTH = 500

/**
 * The widths a poster comes in, narrowest first, so a card fetches one no
 * wider than it shows. A fixed few, never any number, so the server's cache
 * holds at most these.
 */
export const isPosterWidth = oneOf([185, 342, POSTER_OWN_WIDTH])

export type PosterWidth = Infer<typeof isPosterWidth>

export const POSTER_WIDTHS = isPosterWidth.values

/** A backdrop's own width: what the server keeps and serves it at. */
export const BACKDROP_OWN_WIDTH = 1280

/**
 * The widths a poster is asked of an image CDN at, narrowest first: finer
 * steps than the server keeps, since the CDN resizes at the edge, so each
 * card's poster comes within a step of the width it shows. None is wider
 * than the poster's own.
 */
export const CDN_POSTER_WIDTHS = [120, 160, 200, 240, 280, 320, 380, 440, POSTER_OWN_WIDTH] as const

/** The widths a backdrop is asked of an image CDN at, narrowest first, up to its own. */
export const CDN_BACKDROP_WIDTHS = [480, 640, 800, 960, 1120, BACKDROP_OWN_WIDTH] as const

/**
 * The poster width a query's `w` asks for, written as `posterSrcSet` writes
 * it, or null for anything else: another number, or the same one spelled
 * another way.
 */
export const posterWidthFrom = (param: unknown): PosterWidth | null =>
  POSTER_WIDTHS.find((width) => String(width) === param) ?? null

/** Where a picture comes from: a file beside the media, or TMDB. */
export const IMAGE_SOURCES = { local: 'local', tmdb: 'tmdb' } as const

/** One picture a movie or show could show: a file beside the media, or one of TMDB's. */
export const isImageOption = object({
  source: oneOf(Object.values(IMAGE_SOURCES)),
  /** The file's path for `local`; TMDB's path for `tmdb`, served through `imageOptionUrl`. */
  ref: isString,
  width: nullable(isNumber),
  height: nullable(isNumber),
  /** ISO 639-1, or null for a picture with no text. */
  language: nullable(isString),
  /** Whether the item shows this one now. */
  current: isBoolean,
})

export type ImageOption = Infer<typeof isImageOption>

/** Everything a movie or show could show as its poster, backdrop and logo. */
export const isItemImageOptions = object({
  poster: listOf(isImageOption),
  backdrop: listOf(isImageOption),
  /** TMDB's PNG logos. */
  logo: listOf(isImageOption),
})

export type ItemImageOptions = Infer<typeof isItemImageOptions>

/** The pictures Edit images can choose: the ones `ItemImageOptions` offers. */
export type ChoosableImageKind = keyof ItemImageOptions

/** What Edit images picks: one of TMDB's pictures, or the one beside the media. */
export const isImageChoice = union(
  object({ source: oneOf([IMAGE_SOURCES.tmdb]), ref: isString }),
  object({ source: oneOf([IMAGE_SOURCES.local]) }),
)

export type ImageChoice = Infer<typeof isImageChoice>

/**
 * `PUT /api/items/:id/images/:kind`: the picture one library's cards of a
 * title show. Every other library holding it keeps its own.
 */
export const isLibraryImageChoice = object({ libraryId: isNumber, choice: isImageChoice })

export type LibraryImageChoice = Infer<typeof isLibraryImageChoice>

/** The query Edit images is asked with: the library whose cards' pictures it chooses. */
export const ITEM_QUERY_PARAMS = { library: 'library' } as const

/** The parameters a capability picture address names. */
export const PICTURE_PARAMS = { id: 'id', kind: 'kind', version: 'version' } as const

/**
 * Pictures by their capability address: the version, keyed with the
 * server's secret, is the permission, so anyone holding the address may
 * fetch it and any cache may keep it.
 */
export const PICTURE_PATHS = {
  item: '/api/pictures/items/:id/:kind/:version',
  photo: '/api/pictures/people/:id/:version',
} as const
