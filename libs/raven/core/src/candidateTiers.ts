/** The TMDB genre ids the tiers read, the same for movies and shows. */
export const TMDB_GENRES = { animation: 16, family: 10751, documentary: 99 } as const

/**
 * A slice of TMDB's search results a type of library prefers. A result fits
 * when it has one of `genres`, if any are listed, and its original language
 * is one of `languages` or one of its countries is one of `countries`, if
 * either is listed. A tier that lists nothing is every result.
 */
export type CandidateTier = {
  genres?: readonly number[]
  /** ISO 639-1, as TMDB's `original_language` gives it: `ja`. */
  languages?: readonly string[]
  /** ISO 3166-1, as TMDB's `origin_country` gives it: `JP`. */
  countries?: readonly string[]
}

/** What a tier reads of a search result. */
export type TierFacts = {
  genreIds: readonly number[]
  originalLanguage: string | null
  /** A show's countries of origin; a movie's search result has none. */
  countries: readonly string[]
}

const ANYTHING = {} as const satisfies CandidateTier

const { animation, family, documentary } = TMDB_GENRES

/** The results a type of library can prefer, each a set of tiers in `TIER_SETS`. */
export const TIER_SET_NAMES = {
  any: 'any',
  anime: 'anime',
  family: 'family',
  documentary: 'documentary',
} as const

export type TierSet = (typeof TIER_SET_NAMES)[keyof typeof TIER_SET_NAMES]

/**
 * The tiers each type of library searches, in order: the first that picks a
 * result wins. Every set ends with every result, so a type never matches
 * less than Movies or TV shows would. Anime falls back past Japan to any
 * animation, as Chinese donghua and Castlevania sit in Anime libraries too.
 */
export const TIER_SETS = {
  any: [ANYTHING],
  anime: [
    { genres: [animation], languages: ['ja'], countries: ['JP'] },
    { genres: [animation] },
    ANYTHING,
  ],
  family: [{ genres: [family, animation] }, ANYTHING],
  documentary: [{ genres: [documentary] }, ANYTHING],
} as const satisfies Record<TierSet, readonly CandidateTier[]>

/** Whether a tier is every result: the only tier a lone result in the name's year is taken from. */
export const isUnfiltered = (tier: CandidateTier): boolean =>
  tier.genres == null && tier.languages == null && tier.countries == null

export const fitsTier = ({ tier, result }: { tier: CandidateTier; result: TierFacts }): boolean => {
  const hasGenre = tier.genres?.some((genre) => result.genreIds.includes(genre)) ?? true
  if (tier.languages == null && tier.countries == null) return hasGenre
  const { originalLanguage } = result
  const isFromThere =
    (originalLanguage != null && (tier.languages?.includes(originalLanguage) ?? false)) ||
    result.countries.some((country) => tier.countries?.includes(country) ?? false)
  return hasGenre && isFromThere
}
