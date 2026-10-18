import { RATING_SOURCES, type Rating, type RatingSource } from '@raven/core'
import styles from '@/components/RatingPanel/RatingPanel.module.scss'

/** Every source, in the order the panel lists them. */
const SOURCE_ORDER = [
  RATING_SOURCES.rottenTomatoes,
  RATING_SOURCES.imdb,
  RATING_SOURCES.metacritic,
  RATING_SOURCES.tmdb,
] as const satisfies readonly RatingSource[]

const percent = (rating: Rating): string => String(Math.round(rating.value * 10))
const outOfTen = (rating: Rating): string => rating.value.toFixed(1)

/**
 * How each source reads: its name in full, the short label under its score,
 * what its number means, and the scale the score is on. `shown` follows the
 * score on screen, `spoken` follows it in the label.
 */
const SOURCES = {
  rottenTomatoes: {
    site: 'Rotten Tomatoes',
    label: 'Tomatometer',
    meaning: 'Critics who reviewed it positively',
    score: percent,
    shown: '%',
    spoken: '%',
    colour: styles.rottenTomatoes,
  },
  imdb: {
    site: 'IMDb',
    label: 'IMDb',
    meaning: 'Average user rating',
    score: outOfTen,
    shown: '/10',
    spoken: ' out of 10',
    colour: styles.imdb,
  },
  metacritic: {
    site: 'Metacritic',
    label: 'Metascore',
    meaning: 'Weighted critic score',
    score: percent,
    shown: '/100',
    spoken: ' out of 100',
    colour: styles.metacritic,
  },
  tmdb: {
    site: 'TMDB',
    label: 'TMDB',
    meaning: 'Average user rating',
    score: outOfTen,
    shown: '/10',
    spoken: ' out of 10',
    colour: styles.tmdb,
  },
} as const satisfies Record<
  RatingSource,
  {
    site: string
    label: string
    meaning: string
    score: (rating: Rating) => string
    shown: string
    spoken: string
    colour: string | undefined
  }
>

const barWidth = (rating: Rating): string => `${Math.min(100, Math.max(0, rating.value * 10))}%`

const RatingItem = ({ rating }: { rating: Rating }) => {
  const source = SOURCES[rating.source]
  const score = source.score(rating)
  return (
    <li
      className={`${styles.item} ${source.colour}`}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus is how the keyboard reaches the tooltip
      tabIndex={0}
      aria-label={`${source.site}: ${score}${source.spoken}. ${source.meaning}.`}
    >
      <span className={styles.score} aria-hidden="true">
        <span className={styles.value}>{score}</span>
        <span className={styles.scale}>{source.shown}</span>
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ width: barWidth(rating) }} />
      </span>
      <span className={styles.label} aria-hidden="true">
        {source.label}
      </span>
      <span role="tooltip" className={styles.tooltip}>
        <span className={styles.site}>{source.site}</span>
        <span>{source.meaning}</span>
      </span>
    </li>
  )
}

/**
 * A movie's scores in one framed panel: each source's score over a bar in
 * its colour and its name, with the full name and what the number means in
 * a tooltip on hover or focus. A source with no score is left out.
 */
export const RatingPanel = ({ ratings }: { ratings: readonly Rating[] }) => {
  const scored = SOURCE_ORDER.flatMap(
    (source) => ratings.find((each) => each.source === source) ?? [],
  )
  return (
    scored.length > 0 && (
      <ul className={styles.panel} aria-label="Ratings">
        {scored.map((rating) => (
          <RatingItem key={rating.source} rating={rating} />
        ))}
      </ul>
    )
  )
}
