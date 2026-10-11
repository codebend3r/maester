import type { Rating, RatingSource } from '@raven/core'
import styles from '@/components/RatingChips/RatingChips.module.scss'

const NAMES: Record<RatingSource, string> = {
  tmdb: 'TMDB',
  imdb: 'IMDb',
  rottenTomatoes: 'Rotten Tomatoes',
  metacritic: 'Metacritic',
}

/** How each source shows its score: a percentage, out of 10, or out of 100. */
const shown = (rating: Rating): string => {
  if (rating.source === 'imdb') return rating.value.toFixed(1)
  if (rating.source === 'metacritic') return String(Math.round(rating.value * 10))
  return `${Math.round(rating.value * 10)}%`
}

/** What a screen reader hears: "TMDB audience score, 82%". */
export const ratingLabel = (rating: Rating): string =>
  `${NAMES[rating.source]} ${rating.kind} score, ${shown(rating)}`

/** One chip per score, each with its source's mark and its value. */
export const RatingChips = ({ ratings }: { ratings: Rating[] }) =>
  ratings.length > 0 && (
    <ul className={styles.chips} aria-label="Ratings">
      {ratings.map((rating) => (
        <li key={rating.source} className={styles.chip} aria-label={ratingLabel(rating)}>
          <span className={styles.mark} aria-hidden="true">
            {NAMES[rating.source]}
          </span>
          <span className={styles.value} aria-hidden="true">
            {shown(rating)}
          </span>
        </li>
      ))}
    </ul>
  )
