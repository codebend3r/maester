import { type ItemSummary, POSTER_OWN_WIDTH, POSTER_WIDTHS } from '@raven/core'
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
   * A grid of `repeat(auto-fill, minmax(min(10rem, 100%), 1fr))`: a library's,
   * a saga's, a person's and the favourites'. One column on a phone, then
   * columns of 160 to 248 px; past 64rem, four or more under 204 px.
   */
  grid: 'auto, (max-width: 30rem) calc(100vw - 2rem), (max-width: 64rem) 15.5rem, 12.75rem',
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
  /** A Movies library's tile: `clamp(3.5rem, 12vw, 5rem)`. */
  movieTile: 'auto, 5rem',
  /** A movie on the Duplicates tab. */
  duplicate: '(max-width: 30rem) 3.5rem, 5rem',
} as const

export type PosterSizes = (typeof POSTER_SIZES)[keyof typeof POSTER_SIZES]

/**
 * The narrowest each layout shows a poster, in CSS pixels, by the same
 * measure as its `sizes`, or below it where the layout allows narrower.
 */
const NARROWEST: Record<PosterSizes, number> = {
  [POSTER_SIZES.grid]: 160,
  [POSTER_SIZES.row]: 70,
  [POSTER_SIZES.deck]: 118,
  [POSTER_SIZES.season]: 144,
  [POSTER_SIZES.showTile]: 64,
  [POSTER_SIZES.movieTile]: 56,
  [POSTER_SIZES.duplicate]: 56,
}

/**
 * Whether a screen this dense needs a poster's own width even where the
 * layout shows it narrowest, as a phone at 3x does in a grid. There a
 * `srcset` could only ever pick that width, and a grid of thousands of
 * posters would build and parse one for each for nothing.
 */
const needsOwnWidth = (sizes: PosterSizes): boolean =>
  POSTER_WIDTHS.every(
    (width) => width === POSTER_OWN_WIDTH || width < NARROWEST[sizes] * window.devicePixelRatio,
  )

/**
 * An item's poster as an `img`'s `src`, `srcSet` and `sizes`, so the browser
 * picks the width `sizes` needs; just its `src` where it would pick that
 * anyway; null when it has none.
 */
export const posterSources = ({
  item,
  sizes,
}: {
  item: Pick<ItemSummary, 'id' | 'posterVersion'>
  sizes: PosterSizes
}): { src: string; srcSet?: string; sizes?: PosterSizes } | null => {
  const src = api.itemImageUrl({ id: item.id, kind: 'poster', version: item.posterVersion })
  if (!src) return null
  if (needsOwnWidth(sizes)) return { src }
  const srcSet = api.posterSrcSet({ id: item.id, version: item.posterVersion })
  return srcSet ? { src, srcSet, sizes } : { src }
}
