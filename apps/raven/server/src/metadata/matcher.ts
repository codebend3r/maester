import { foldTitle, type MatchItemType } from '@raven/core'
import type { SearchResult } from '@/metadata/tmdbClient'

/** The most popular of `results`, TMDB's own order (popularity first) breaking a tie. */
const mostPopular = (results: readonly SearchResult[]): SearchResult | null =>
  results.reduce<SearchResult | null>(
    (best, result) =>
      best == null || (result.popularity ?? -1) > (best.popularity ?? -1) ? result : best,
    null,
  )

/**
 * The search result a parsed name is, or null when raven cannot be sure.
 *
 * - A result whose title or original title folds to the same as the name's,
 *   released in the name's year or one either side (release dates differ by
 *   country), or failing that within three years, the nearest first (a
 *   festival premiere and a release can sit two years apart). The exact
 *   year wins over a neighbour.
 * - Otherwise, the only result there is, when its year is the name's.
 * - Without a year (Sonarr's show folders carry none), a show with the same
 *   title. A movie needs to be the one result with its title, as an
 *   original and its remake share it and only the year tells them apart.
 *
 * A show named with a country, "The Office (UK)", only takes a result from
 * there. Two results with the same title, as with a remake or a show TMDB
 * lists twice, go to the more popular one. Anything else is unmatched:
 * raven never guesses at a different title.
 */
export const pickMatch = ({
  type,
  title,
  year,
  country = null,
  results,
}: {
  type: MatchItemType
  title: string
  year: number | null
  /** The country the name gives, as TMDB writes it: `GB` for "(UK)". */
  country?: string | null
  results: readonly SearchResult[]
}): SearchResult | null => {
  const wanted = foldTitle(title)
  const fromThere = (result: SearchResult): boolean =>
    country == null || result.countries.includes(country)
  const sameTitle = results.filter(
    (result) =>
      fromThere(result) &&
      (foldTitle(result.title) === wanted ||
        (result.originalTitle != null && foldTitle(result.originalTitle) === wanted)),
  )

  if (year == null) {
    if (type === 'show') return mostPopular(sameTitle)
    const [lone] = sameTitle
    return sameTitle.length === 1 ? (lone ?? null) : null
  }

  const exact = mostPopular(sameTitle.filter((result) => result.year === year))
  if (exact) return exact
  const near = mostPopular(
    sameTitle.filter((result) => result.year != null && Math.abs(result.year - year) === 1),
  )
  if (near) return near
  const close = sameTitle
    .filter((result) => result.year != null && Math.abs(result.year - year) <= 3)
    .toSorted((a, b) => Math.abs((a.year ?? 0) - year) - Math.abs((b.year ?? 0) - year))
  const [nearest] = close
  if (nearest) {
    return mostPopular(close.filter((result) => result.year === nearest.year))
  }

  const [only] = results
  return results.length === 1 && only != null && only.year === year && fromThere(only) ? only : null
}
