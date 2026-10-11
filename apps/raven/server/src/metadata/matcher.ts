import { foldTitle } from '@raven/core'
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
 *   country). The exact year wins over a neighbour.
 * - Otherwise, the only result there is, when its year is the name's.
 * - Without a year (Sonarr's show folders carry none), a result with the
 *   same title.
 *
 * Two results with the same title, as with a remake or a show TMDB lists
 * twice, go to the more popular one. Anything else is unmatched: raven never
 * guesses at a different title.
 */
export const pickMatch = ({
  title,
  year,
  results,
}: {
  title: string
  year: number | null
  results: readonly SearchResult[]
}): SearchResult | null => {
  const wanted = foldTitle(title)
  const sameTitle = results.filter(
    (result) =>
      foldTitle(result.title) === wanted ||
      (result.originalTitle != null && foldTitle(result.originalTitle) === wanted),
  )

  if (year == null) return mostPopular(sameTitle)

  const exact = mostPopular(sameTitle.filter((result) => result.year === year))
  if (exact) return exact
  const near = mostPopular(
    sameTitle.filter((result) => result.year != null && Math.abs(result.year - year) === 1),
  )
  if (near) return near

  const [only] = results
  return results.length === 1 && (only?.year ?? null) === year ? (only ?? null) : null
}
