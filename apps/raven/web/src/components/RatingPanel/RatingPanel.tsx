import { RATING_SOURCES, type Rating, type RatingSource, pickScore } from '@raven/core'
import { RATING_SOURCE_LABELS } from '@/lib/ratingSources'
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
    site: RATING_SOURCE_LABELS.rottenTomatoes,
    label: 'Tomatometer',
    meaning: 'Critics who reviewed it positively',
    score: percent,
    shown: '%',
    spoken: '%',
    className: styles.rottenTomatoes,
  },
  imdb: {
    site: RATING_SOURCE_LABELS.imdb,
    label: 'IMDb',
    meaning: 'Average user rating',
    score: outOfTen,
    shown: '/10',
    spoken: ' out of 10',
    className: styles.imdb,
  },
  metacritic: {
    site: RATING_SOURCE_LABELS.metacritic,
    label: 'Metascore',
    meaning: 'Weighted critic score',
    score: percent,
    shown: '/100',
    spoken: ' out of 100',
    className: styles.metacritic,
  },
  tmdb: {
    site: RATING_SOURCE_LABELS.tmdb,
    label: 'TMDB',
    meaning: 'Average user rating',
    score: outOfTen,
    shown: '/10',
    spoken: ' out of 10',
    className: styles.tmdb,
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
    className: string | undefined
  }
>

const barWidth = (rating: Rating): string => `${Math.min(100, Math.max(0, rating.value * 10))}%`

type RatingItemProps = { rating: Rating }

const RatingItem = ({ rating }: RatingItemProps) => {
  const source = SOURCES[rating.source]
  const score = source.score(rating)
  return (
    <li
      className={`${styles.item} ${source.className}`}
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
      <span className={styles.tooltip} aria-hidden="true">
        <span className={styles.site}>{source.site}</span>
        <span>{source.meaning}</span>
      </span>
    </li>
  )
}

type RatingBadgeProps = { rating: Rating; isBare?: boolean }

/**
 * One score where a card or a row has a line for it: the panel's score,
 * scale and name in a small frame, its bar along the frame's foot. `isBare`
 * keeps only the score, for a table whose column header already names the source.
 */
export const RatingBadge = ({ rating, isBare = false }: RatingBadgeProps) => {
  const source = SOURCES[rating.source]
  const score = source.score(rating)
  return (
    <span className={`${styles.badge} ${isBare ? styles.badgeBare : ''} ${source.className}`}>
      <span className="visually-hidden">{`${source.site}: ${score}${source.spoken}`}</span>
      <span className={styles.badgeScore} aria-hidden="true">
        <span className={styles.badgeValue}>{score}</span>
        {!isBare && <span className={styles.badgeScale}>{source.shown}</span>}
      </span>
      {!isBare && (
        <span className={styles.badgeLabel} aria-hidden="true">
          {source.label}
        </span>
      )}
      <span className={styles.badgeTrack} aria-hidden="true">
        <span className={styles.fill} style={{ width: barWidth(rating) }} />
      </span>
    </span>
  )
}

type RatingPanelProps = { ratings: readonly Rating[] }

/**
 * A movie's scores in one framed panel: each source's score over a bar in
 * its colour and its name, with the full name and what the number means in
 * a tooltip on hover or focus. A source with no score is left out.
 */
export const RatingPanel = ({ ratings }: RatingPanelProps) => {
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

const inSourceOrder = (ratings: readonly Rating[]): Rating[] =>
  SOURCE_ORDER.flatMap((source) => ratings.find((each) => each.source === source) ?? [])

type RatingChipProps = {
  ratings: readonly Rating[]
  lead?: RatingSource
}

/**
 * Every score a title has, as one chip: the lead score, TMDB's unless the
 * caller names another, and how many more there are. Pointing at it or
 * focusing it opens a popover over the chip with each score in its own row.
 * The popover grows upward so a card that clips what lies below it keeps it.
 * A title with a single score gets the chip alone.
 */
export const RatingChip = ({ ratings, lead = RATING_SOURCES.tmdb }: RatingChipProps) => {
  const scored = inSourceOrder(ratings)
  const first = pickScore({ ratings: scored, source: lead }) ?? scored[0]
  if (!first) return null
  const more = scored.length - 1
  const spoken = scored
    .map(
      (rating) =>
        `${SOURCES[rating.source].site} ${SOURCES[rating.source].score(rating)}${SOURCES[rating.source].spoken}`,
    )
    .join(', ')
  return (
    <span
      className={styles.chip}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a chip of marks read as one label, not a picture
      role="img"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus is how the keyboard reaches the popover
      tabIndex={more > 0 ? 0 : undefined}
      aria-label={`Ratings: ${spoken}`}
    >
      <span className={styles.chipFace} aria-hidden="true">
        <RatingBadge rating={first} />
        {more > 0 && <span className={styles.chipMore}>{`+${more}`}</span>}
      </span>
      {more > 0 && (
        <ul className={styles.popover} aria-hidden="true">
          {scored.map((rating) => {
            const source = SOURCES[rating.source]
            return (
              <li key={rating.source} className={`${styles.popoverRow} ${source.className}`}>
                <span className={styles.popoverSite}>{source.site}</span>
                <span className={styles.popoverScore}>
                  <span className={styles.badgeValue}>{source.score(rating)}</span>
                  <span className={styles.badgeScale}>{source.shown}</span>
                </span>
                <span className={styles.popoverTrack}>
                  <span className={styles.fill} style={{ width: barWidth(rating) }} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </span>
  )
}
