import { RATING_SOURCES, type Rating, type RatingSource, formatScore } from '@raven/core'
import { RatingMark, SourceMark, isFresh } from '@/components/RatingMark/RatingMark'
import styles from '@/components/RatingChips/RatingChips.module.scss'

const NAMES: Record<RatingSource, string> = {
  tmdb: 'TMDB',
  imdb: 'IMDb',
  rottenTomatoes: 'Rotten Tomatoes',
  metacritic: 'Metacritic',
}

/** What a screen reader hears: "Rotten Tomatoes critics, 41%, rotten" or "TMDB audience score, 82%". */
export const ratingLabel = (rating: Rating): string => {
  if (rating.source === RATING_SOURCES.rottenTomatoes) {
    return `Rotten Tomatoes critics, ${formatScore(rating)}, ${isFresh(rating) ? 'fresh' : 'rotten'}`
  }
  if (rating.source === RATING_SOURCES.metacritic)
    return `Metacritic, ${formatScore(rating)} out of 100`
  if (rating.source === RATING_SOURCES.imdb) return `IMDb, ${formatScore(rating)} out of 10`
  return `${NAMES[rating.source]} ${rating.kind} score, ${formatScore(rating)}`
}

/** Every source, in the order the server lists an item's scores. */
const SCORE_ORDER = [
  RATING_SOURCES.rottenTomatoes,
  RATING_SOURCES.imdb,
  RATING_SOURCES.metacritic,
  RATING_SOURCES.tmdb,
] as const satisfies readonly RatingSource[]

/** A chip: a source's score, or a source that has none for this item. */
type Chip = { type: 'scored'; rating: Rating } | { type: 'unscored'; source: RatingSource }

const chipsFor = ({
  ratings,
  shouldShowEverySource,
}: {
  ratings: readonly Rating[]
  shouldShowEverySource: boolean
}): Chip[] =>
  shouldShowEverySource
    ? SCORE_ORDER.map((source): Chip => {
        const rating = ratings.find((each) => each.source === source)
        return rating ? { type: 'scored', rating } : { type: 'unscored', source }
      })
    : ratings.map((rating): Chip => ({ type: 'scored', rating }))

const chipSource = (chip: Chip): RatingSource =>
  chip.type === 'scored' ? chip.rating.source : chip.source

const ChipItem = ({ chip }: { chip: Chip }) => {
  switch (chip.type) {
    case 'scored':
      return (
        <li className={styles.chip} aria-label={ratingLabel(chip.rating)}>
          <RatingMark rating={chip.rating} />
          <span className={styles.value} aria-hidden="true">
            {formatScore(chip.rating)}
          </span>
        </li>
      )
    case 'unscored':
      return (
        <li
          className={`${styles.chip} ${styles.unscored}`}
          aria-label={`${NAMES[chip.source]}: no score`}
        >
          <SourceMark source={chip.source} />
          <span className={styles.value} aria-hidden="true">
            -
          </span>
        </li>
      )
    default: {
      const unknown: never = chip
      return unknown
    }
  }
}

/**
 * One pill per score, each with its source's mark and its value. With
 * `shouldShowEverySource`, as a movie's page has it, every source gets a
 * chip in a fixed order, and one with no score for the item says so.
 */
export const RatingChips = ({
  ratings,
  shouldShowEverySource = false,
}: {
  ratings: readonly Rating[]
  shouldShowEverySource?: boolean
}) => {
  const chips = chipsFor({ ratings, shouldShowEverySource })
  return (
    chips.length > 0 && (
      <ul className={styles.chips} aria-label="Ratings">
        {chips.map((chip) => (
          <ChipItem key={chipSource(chip)} chip={chip} />
        ))}
      </ul>
    )
  )
}

/** A score on a card: the mark and the value, small. */
export const ScoreChip = ({ rating }: { rating: Rating }) => (
  <span className={styles.score} aria-label={ratingLabel(rating)}>
    <RatingMark rating={rating} size={14} />
    <span aria-hidden="true">{formatScore(rating)}</span>
  </span>
)
