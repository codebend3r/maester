import { RATING_SOURCES, type Rating, type RatingSource } from '@raven/core'
import type { ReactNode } from 'react'
import styles from '@/components/RatingMark/RatingMark.module.scss'

/** A fresh tomato at 60% or more, a splat below. */
export const isFresh = (rating: Rating): boolean => rating.value >= 6

/** Metacritic's bands: green from 61, yellow from 40, red below. */
const metacriticBand = (rating: Rating): 'green' | 'yellow' | 'red' => {
  const score = Math.round(rating.value * 10)
  if (score >= 61) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}

const Tomato = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="14" r="8" fill="currentColor" />
    <path d="M8.5 6.5c1.8-1.6 5.2-1.6 7 0-1.2.7-2.3 1-3.5 1s-2.3-.3-3.5-1z" fill="currentColor" />
  </svg>
)

const Splat = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 3l2.2 5 5-1.2-2.4 4.4 4.2 2.3-4.9 1.4 1 4.9-4.3-2.8-2.7 4.2-1.5-4.9-4.9 1 2.8-4.3L2.8 11l4.9-1.5L6 4.8l4.3 2.7z"
      fill="currentColor"
    />
  </svg>
)

/** Each source's look: its shape and its colours, as the brand keeps them in every theme. */
const LOOKS = {
  rottenTomatoes: styles.round,
  imdb: `${styles.badge} ${styles.imdb}`,
  metacritic: `${styles.badge} ${styles.green}`,
  tmdb: `${styles.badge} ${styles.tmdb}`,
} as const satisfies Record<RatingSource, string | undefined>

const BANDS = {
  green: styles.green,
  yellow: styles.yellow,
  red: styles.red,
} as const satisfies Record<ReturnType<typeof metacriticBand>, string | undefined>

const WORDS = {
  rottenTomatoes: 'RT',
  imdb: 'IMDb',
  metacritic: 'MC',
  tmdb: 'TMDB',
} as const satisfies Record<RatingSource, string>

/** The mark's frame at `size` pixels tall, its words scaled with it. */
const Mark = ({
  className,
  size,
  children,
}: {
  className: string
  size: number
  children: ReactNode
}) => (
  <span
    className={`${styles.mark} ${className}`}
    style={{ minWidth: size, height: size, fontSize: Math.max(7, size * 0.42) }}
    aria-hidden="true"
  >
    {children}
  </span>
)

/**
 * The small mark beside a score, in its source's colours: a tomato on red,
 * or a splat on grey below 60%, IMDb's badge, Metacritic's square in its
 * band, and TMDB's. Drawn here rather than in `Icon`, whose glyphs are
 * line drawings. Decorative: the chip around it carries the label.
 */
export const RatingMark = ({ rating, size = 26 }: { rating: Rating; size?: number }) => {
  switch (rating.source) {
    case RATING_SOURCES.rottenTomatoes:
      return isFresh(rating) ? (
        <Mark className={`${styles.round} ${styles.fresh}`} size={size}>
          <Tomato size={size * 0.62} />
        </Mark>
      ) : (
        <Mark className={`${styles.round} ${styles.rotten}`} size={size}>
          <Splat size={size * 0.62} />
        </Mark>
      )
    case RATING_SOURCES.metacritic:
      return (
        <Mark className={`${styles.badge} ${BANDS[metacriticBand(rating)]}`} size={size}>
          {WORDS.metacritic}
        </Mark>
      )
    case RATING_SOURCES.imdb:
    case RATING_SOURCES.tmdb:
      return (
        <Mark className={LOOKS[rating.source]} size={size}>
          {WORDS[rating.source]}
        </Mark>
      )
    default: {
      const unknown: never = rating.source
      return unknown
    }
  }
}

/**
 * A source's mark with no score to draw it from, for a chip that says the
 * source has none: its name in the page's greys, in its shape, outlined.
 */
export const SourceMark = ({ source, size = 26 }: { source: RatingSource; size?: number }) => (
  <Mark className={`${LOOKS[source]} ${styles.unscored}`} size={size}>
    {WORDS[source]}
  </Mark>
)
