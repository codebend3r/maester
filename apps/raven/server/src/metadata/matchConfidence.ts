import {
  CONFIDENCE_STRONG,
  type CandidateTier,
  fitsTier,
  foldTitle,
  isUnfiltered,
  type ParsedEpisodeName,
  ITEM_TYPES,
} from '@raven/core'
import type { MatchFacts, SearchResult } from '@/metadata/tmdbClient'

/** A show file's numbers, and the year its name gives, as `parseEpisodeName` reads them. */
export type EpisodeNumbers = Pick<ParsedEpisodeName, 'season' | 'episodes' | 'absolute' | 'year'>

/** What the folder or file Fix match is for has on disk. */
export type OnDisk =
  | { type: typeof ITEM_TYPES.show; files: readonly EpisodeNumbers[] }
  | {
      type: typeof ITEM_TYPES.movie
      /** Seconds; null until the file has been probed, or for an edition, which runs its own length. */
      duration: number | null
    }

type ShowFacts = Extract<MatchFacts, { type: typeof ITEM_TYPES.show }>

/** The most a title that is not the searched one counts for. */
const PARTIAL_TITLE = 0.8
/** What an exact title is worth when nothing else agrees: Possible, never Weak. */
const SUPPORT_FLOOR = 0.6
const WEIGHTS = { year: 30, fit: 20, libraryType: 5, popularity: 5 } as const
/** Where a result that cannot be the one is held: Weak. */
const RULED_OUT = 40
/** How near the runner-up has to be to make a close call. */
const CLOSE_CALL = 10

const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u

/**
 * A title folded for comparison. `foldTitle` keeps only Latin letters and
 * digits, so a title with a letter of another script (몬스터, 응답하라 1988),
 * or with nothing it keeps, is compared lower-cased instead; otherwise every
 * Korean title would be every other's, or each one's digits.
 */
const comparable = (title: string): string => {
  const lowered = title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  return NON_LATIN_LETTER.test(title) ? lowered : foldTitle(title) || lowered
}

type EditDistanceProps = { a: readonly string[]; b: readonly string[] }

/** How many single-character edits turn `a` into `b`. */
const editDistance = ({ a, b }: EditDistanceProps): number => {
  const first = Array.from({ length: b.length + 1 }, (_, index) => index)
  const last = a.reduce(
    (above, charA, row) =>
      b.reduce<number[]>(
        (current, charB, column) =>
          current.concat(
            Math.min(
              (above[column + 1] ?? 0) + 1,
              (current[column] ?? 0) + 1,
              (above[column] ?? 0) + (charA === charB ? 0 : 1),
            ),
          ),
        [row + 1],
      ),
    first,
  )
  return last[b.length] ?? 0
}

type SimilarityProps = { a: string; b: string }

/** 1 for the same text, falling with each edit, by the longer's length. */
const similarity = ({ a, b }: SimilarityProps): number => {
  const charsA = [...a]
  const charsB = [...b]
  const longer = Math.max(charsA.length, charsB.length)
  return longer === 0 ? 0 : 1 - editDistance({ a: charsA, b: charsB }) / longer
}

type TitleScoreProps = { wanted: string; names: readonly string[] }

const titleScore = ({ wanted, names }: TitleScoreProps): number => {
  const folded = names.map(comparable)
  if (folded.includes(wanted)) return 1
  return PARTIAL_TITLE * Math.max(0, ...folded.map((name) => similarity({ a: wanted, b: name })))
}

type YearScoreProps = { asked: number; released: number | null }

const yearScore = ({ asked, released }: YearScoreProps): number => {
  if (released == null) return 0
  const gap = Math.abs(released - asked)
  if (gap === 0) return 1
  if (gap === 1) return 0.8
  if (gap <= 3) return 0.4
  return 0
}

/**
 * A file's numbers as a fit reads them: episode 0, a pilot, is no number,
 * and nor is an absolute number that is the name's year, as
 * `Monster (2004) - Making Of` reads.
 */
const fitNumbers = (file: EpisodeNumbers): EpisodeNumbers => ({
  season: file.season,
  episodes: file.episodes.filter((episode) => episode > 0),
  absolute: file.absolute === file.year ? null : file.absolute,
  year: file.year,
})

type ShowFitProps = {
  files: readonly EpisodeNumbers[]
  facts: ShowFacts
}

/**
 * 1 when every numbered file fits the show: its season holds its episode,
 * or it is in season 1 within the show's total (numbered straight through),
 * or its absolute number is within the total. Season 0 and unnumbered files
 * are left out; null when none is left.
 */
const showFit = ({ files, facts }: ShowFitProps): number | null => {
  const numbered = files
    .map(fitNumbers)
    .filter((file) => file.season !== 0 && (file.episodes.length > 0 || file.absolute != null))
  if (numbered.length === 0) return null
  const total = facts.episodeCount ?? 0
  const fits = (file: EpisodeNumbers): boolean => {
    const highest = Math.max(0, ...file.episodes)
    const season = facts.seasons.find((each) => each.number === file.season)
    const isInSeason = highest > 0 && season != null && highest <= season.episodeCount
    const isStraightThrough = file.season === 1 && highest > 0 && highest <= total
    const isAbsoluteWithin = file.absolute != null && file.absolute <= total
    return isInSeason || isStraightThrough || isAbsoluteWithin
  }
  return numbered.every(fits) ? 1 : 0
}

type MovieFitProps = {
  duration: number | null
  runtime: number | null
}

const movieFit = ({ duration, runtime }: MovieFitProps): number | null => {
  if (duration == null || runtime == null) return null
  const gap = Math.abs(duration / 60 - runtime)
  if (gap <= 10) return 1
  if (gap <= 25) return 0.5
  return 0
}

type FitScoreProps = {
  onDisk: OnDisk | null
  facts: MatchFacts | undefined
}

const fitScore = ({ onDisk, facts }: FitScoreProps): number | null => {
  if (onDisk == null || facts == null) return null
  if (onDisk.type === ITEM_TYPES.show && facts.type === ITEM_TYPES.show)
    return showFit({ files: onDisk.files, facts })
  if (onDisk.type === ITEM_TYPES.movie && facts.type === ITEM_TYPES.movie) {
    return movieFit({ duration: onDisk.duration, runtime: facts.runtime })
  }
  return null
}

/** The weighted mean of the signals measured; 1 when none is. */
const supportOf = (signals: ReadonlyArray<{ weight: number; value: number | null }>): number => {
  const measured = signals.flatMap(({ weight, value }) =>
    value == null ? [] : [{ weight, value }],
  )
  const weights = measured.reduce((sum, { weight }) => sum + weight, 0)
  if (weights === 0) return 1
  return measured.reduce((sum, { weight, value }) => sum + weight * value, 0) / weights
}

/** Two results within 10 of a Strong top, that nothing tells apart, are both held at Possible. */
const settleCloseCall = (scores: readonly number[]): number[] => {
  const top = Math.max(0, ...scores)
  const isContender = (score: number): boolean => score >= top - CLOSE_CALL
  if (top < CONFIDENCE_STRONG || scores.filter(isContender).length < 2) return [...scores]
  return scores.map((score) =>
    isContender(score) ? Math.min(score, CONFIDENCE_STRONG - 1) : score,
  )
}

type ScoreCandidatesProps = {
  /** The searched title. */
  title: string
  /** The searched year; null when none was asked. */
  year: number | null
  /** The country the subject's name or the searched title gives, as TMDB writes it: `GB`. */
  country: string | null
  results: readonly SearchResult[]
  /** The library type's first tier; one that filters nothing for no library. */
  tier: CandidateTier
  onDisk: OnDisk | null
  /** The details read for some results, by TMDB id. */
  facts: ReadonlyMap<string, MatchFacts>
}

/**
 * How sure Fix match is of each result, from 0 to 100, in the order given:
 * the title, scaled by how well the year, what is on disk, the library's
 * type and popularity agree. See the spec's "Scoring".
 */
export const scoreCandidates = ({
  title,
  year,
  country,
  results,
  tier,
  onDisk,
  facts,
}: ScoreCandidatesProps): number[] => {
  const wanted = comparable(title)
  const isElsewhere = (result: SearchResult): boolean =>
    country != null && result.countries.length > 0 && !result.countries.includes(country)
  const titles = results.map((result) =>
    titleScore({
      wanted,
      names: [
        result.title,
        ...(result.originalTitle == null ? [] : [result.originalTitle]),
        ...(facts.get(result.tmdbId)?.aliases ?? []),
      ],
    }),
  )
  type IsPopularityMeasuredProps = {
    result: SearchResult
    index: number
  }

  // Popularity only tells apart results that share the title and are not ruled out by country.
  const isPopularityMeasured = ({ result, index }: IsPopularityMeasuredProps): boolean =>
    titles[index] === 1 && !isElsewhere(result)
  const mostPopular = Math.max(
    0,
    ...results.flatMap((result, index) =>
      isPopularityMeasured({ result, index }) ? [result.popularity ?? 0] : [],
    ),
  )
  const scores = results.map((result, index) => {
    const titled = titles[index] ?? 0
    const fit = fitScore({ onDisk, facts: facts.get(result.tmdbId) })
    const support = supportOf([
      {
        weight: WEIGHTS.year,
        value: year == null ? null : yearScore({ asked: year, released: result.year }),
      },
      { weight: WEIGHTS.fit, value: fit },
      {
        weight: WEIGHTS.libraryType,
        value: isUnfiltered(tier) ? null : Number(fitsTier({ tier, result })),
      },
      {
        weight: WEIGHTS.popularity,
        value:
          isPopularityMeasured({ result, index }) && mostPopular > 0
            ? (result.popularity ?? 0) / mostPopular
            : null,
      },
    ])
    const score = Math.round(100 * titled * (SUPPORT_FLOOR + (1 - SUPPORT_FLOOR) * support))
    return fit === 0 || isElsewhere(result) ? Math.min(score, RULED_OUT) : score
  })
  return settleCloseCall(scores)
}
