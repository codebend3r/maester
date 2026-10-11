import type { Rating } from '@raven/core'
import styles from '@/components/RatingMark/RatingMark.module.scss'

/** A fresh tomato at 60% or more, a splat below. */
export const isFresh = (rating: Rating): boolean => rating.value >= 6

/** Metacritic's bands: green from 61, yellow from 40, red below. */
export const metacriticBand = (rating: Rating): 'green' | 'yellow' | 'red' => {
  const score = Math.round(rating.value * 10)
  if (score >= 61) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}

/**
 * The small mark beside a score: a tomato or splat, IMDb's badge, a
 * Metacritic square in its band, or TMDB's pill. Drawn here rather than in
 * `Icon`, whose glyphs are one-stroke lines. Decorative: the chip around it
 * carries the label.
 */
export const RatingMark = ({ rating, size = 18 }: { rating: Rating; size?: number }) => {
  if (rating.source === 'rottenTomatoes') {
    return isFresh(rating) ? (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="14" r="8.5" className={styles.tomato} />
        <path d="M9 6.5c1.5-2 4.5-2 6 0-1 .5-2 .8-3 .8s-2-.3-3-.8z" className={styles.leaf} />
        <path d="M12 7.3V4.5" className={styles.stem} />
      </svg>
    ) : (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 4l2 4.5 4.5-1-2 4 4 2-4.5 1.5 1 4.5-4-2.5-2.5 4-1.5-4.5-4.5 1 2.5-4L3 11l4.5-1.5L6 5l4 2.5z"
          className={styles.splat}
        />
      </svg>
    )
  }
  if (rating.source === 'imdb') {
    return (
      <span className={styles.imdb} style={{ fontSize: size * 0.5 }} aria-hidden="true">
        IMDb
      </span>
    )
  }
  if (rating.source === 'metacritic') {
    return (
      <span
        className={`${styles.metacritic} ${styles[metacriticBand(rating)]}`}
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden="true"
      >
        {Math.round(rating.value * 10)}
      </span>
    )
  }
  return (
    <span className={styles.tmdb} style={{ fontSize: size * 0.5 }} aria-hidden="true">
      TMDB
    </span>
  )
}
