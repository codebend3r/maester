import { type ItemSummary, POSTER_OWN_WIDTH, ITEM_IMAGE_KINDS } from '@raven/core'
import { api } from '@/lib/api'

/**
 * How wide a poster shows in each layout that lists them, as an `img`'s
 * `sizes`, so the browser fetches the narrowest of a poster's widths that
 * stays sharp. `auto` comes first: a browser that knows it sizes a lazy
 * picture by the width it is laid out at, which no media query can know, as
 * a grid's columns hang on the side menu's width. The rest is for the
 * browsers that do not, measured in Chrome from 320 to 1920 px wide with the
 * side menu open and collapsed: each is at least as wide as the poster ever
 * shows at that width, never narrower, so none is fetched too small. A
 * change to one of these layouts wants its line here measured again.
 */
export const POSTER_SIZES = {
  /**
   * `MediaGrid`'s posters, columns of 168 px at least with 16 px between,
   * 150 px under 64rem and 128 px under 48rem: a library's, a saga's, a
   * person's and the favourites'. Two columns that just miss fitting a third
   * are the widest it lays out, half a column and a gap wider than the
   * least: 200 px under 48rem, 233 px under 64rem and 260 px past it.
   */
  grid: 'auto, (max-width: 48rem) 12.5rem, (max-width: 64rem) 14.625rem, 16.25rem',
  /**
   * `CoverGrid`'s posters, columns of 136 px at least with 8 px between, 104
   * px under 48rem. Two columns that just miss fitting a third are the
   * widest it lays out, half a column and a gap wider than the least: 160 px
   * under 48rem and 208 px past it.
   */
  cover: 'auto, (max-width: 48rem) 10rem, 13rem',
  /** An album page's cover: the screen's width on a phone, 16rem beside the words past it. */
  album: '(max-width: 40rem) calc(100vw - 2rem), 16rem',
  /** The now-playing bar's cover, a control tall. */
  bar: '3rem',
  /** An album or playlist's cover on Downloads, a control tall. */
  download: '3rem',
  /** Now Playing's cover: most of a phone's width, 24rem past it. */
  nowPlaying: '(max-width: 40rem) calc(100vw - 4rem), 24rem',
  /**
   * Home's rows: two, four, then eight across the page, which stops growing
   * at 120rem.
   */
  row: 'auto, (max-width: 40rem) calc(50vw - 1.5rem), (max-width: 64rem) calc(23vw - 0.75rem), (max-width: 120rem) calc(12.5vw - 2rem), 13rem',
  /** A saga's deck: 55% of its card, in a grid of `minmax(min(15rem, 100%), 1fr)`. */
  deck: 'auto, (max-width: 40rem) calc(55vw - 1.75rem), (max-width: 48rem) 12rem, (max-width: 64rem) 16.5rem, 12rem',
  /** A season in its show's row: `9rem`. */
  season: '9rem',
  /** A TV library's tile: `clamp(4rem, 14vw, 6rem)`. */
  showTile: 'auto, 6rem',
  /** A TV library's card, its poster beside its words: `6rem`. */
  showCard: '6rem',
  /** A Movies library's tile: `clamp(3.5rem, 12vw, 5rem)`. */
  movieTile: 'auto, 5rem',
  /** A row of a Movies or TV library's list: `2.25rem`. */
  list: '2.25rem',
  /** A movie on the Duplicates tab. */
  duplicate: '(max-width: 30rem) 3.5rem, 5rem',
} as const

export type PosterSizes = (typeof POSTER_SIZES)[keyof typeof POSTER_SIZES]

/**
 * The narrowest each layout shows a poster, in CSS pixels, by the same
 * measure as its `sizes`, or below it where the layout allows narrower.
 */
const NARROWEST: Record<PosterSizes, number> = {
  [POSTER_SIZES.grid]: 128,
  [POSTER_SIZES.cover]: 104,
  [POSTER_SIZES.row]: 70,
  [POSTER_SIZES.deck]: 118,
  [POSTER_SIZES.season]: 144,
  [POSTER_SIZES.showTile]: 64,
  [POSTER_SIZES.showCard]: 96,
  [POSTER_SIZES.movieTile]: 56,
  [POSTER_SIZES.list]: 36,
  [POSTER_SIZES.duplicate]: 56,
  [POSTER_SIZES.album]: 256,
  [POSTER_SIZES.bar]: 48,
  [POSTER_SIZES.nowPlaying]: 288,
}

/**
 * Whether a screen this dense needs a poster's own width even where the
 * layout shows it narrowest, as a phone at 3x does in a grid. There a
 * `srcset` could only ever pick that width, and a grid of thousands of
 * posters would build and parse one for each for nothing. Chrome takes the
 * narrowest file at least as wide as the slot times the ratio, with no
 * rounding down between two (checked in Chrome 155), so that is the test.
 */
const needsOwnWidth = (sizes: PosterSizes): boolean =>
  api.posterWidths.every(
    (width) => width === POSTER_OWN_WIDTH || width < NARROWEST[sizes] * window.devicePixelRatio,
  )

type PosterSourcesProps = {
  item: Pick<ItemSummary, 'id' | 'posterVersion'>
  sizes: PosterSizes
}

/**
 * An item's poster as an `img`'s `src`, `srcSet` and `sizes`, so the browser
 * picks the width `sizes` needs; just its `src` where it would pick that
 * anyway; null when it has none.
 */
export const posterSources = ({
  item,
  sizes,
}: PosterSourcesProps): { src: string; srcSet?: string; sizes?: PosterSizes } | null => {
  const src = api.itemImageUrl({
    id: item.id,
    kind: ITEM_IMAGE_KINDS.poster,
    version: item.posterVersion,
  })
  if (!src) return null
  if (needsOwnWidth(sizes)) return { src }
  const srcSet = api.posterSrcSet({ id: item.id, version: item.posterVersion })
  return srcSet ? { src, srcSet, sizes } : { src }
}
