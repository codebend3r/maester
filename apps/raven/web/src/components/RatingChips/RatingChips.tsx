import { RATING_SOURCES, type Rating, type RatingSource, formatScore } from '@raven/core'
import { RatingMark, isFresh } from '@/components/RatingMark/RatingMark'
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

/** A score on a card: the mark and the value, small. */
export const ScoreChip = ({ rating }: { rating: Rating }) => (
  <span className={styles.score} aria-label={ratingLabel(rating)}>
    <RatingMark rating={rating} size={14} />
    <span aria-hidden="true">{formatScore(rating)}</span>
  </span>
)
