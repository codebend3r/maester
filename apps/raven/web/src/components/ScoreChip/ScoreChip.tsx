import { RATING_SOURCES, type Rating, formatScore } from '@raven/core'
import { RatingMark, isFresh } from '@/components/ScoreChip/RatingMark'
import { RATING_SOURCE_LABELS } from '@/lib/ratingSources'
import styles from '@/components/ScoreChip/ScoreChip.module.scss'

/** What a screen reader hears: "Rotten Tomatoes critics, 41%, rotten" or "TMDB audience score, 82%". */
export const ratingLabel = (rating: Rating): string => {
  if (rating.source === RATING_SOURCES.rottenTomatoes) {
    return `Rotten Tomatoes critics, ${formatScore(rating)}, ${isFresh(rating) ? 'fresh' : 'rotten'}`
  }
  if (rating.source === RATING_SOURCES.metacritic)
    return `Metacritic, ${formatScore(rating)} out of 100`
  if (rating.source === RATING_SOURCES.imdb) return `IMDb, ${formatScore(rating)} out of 10`
  return `${RATING_SOURCE_LABELS[rating.source]} ${rating.kind} score, ${formatScore(rating)}`
}

/** A score on a card: the mark and the value, small. */
export const ScoreChip = ({ rating }: { rating: Rating }) => (
  <span className={styles.score} aria-label={ratingLabel(rating)}>
    <RatingMark rating={rating} size={14} />
    <span aria-hidden="true">{formatScore(rating)}</span>
  </span>
)
