import {
  UPCOMING_SHELVES,
  type UpcomingShelf,
  type UpcomingTitle,
  formatAirDate,
} from '@raven/core'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { tmdbTitleUrl } from '@/lib/tmdbLinks'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import styles from '@/pages/ComingSoonPage/UpcomingCard.module.scss'

/** Whether a shelf's cards say if each is a movie or a show: only where it holds both. */
const SHOWS_KIND = {
  [UPCOMING_SHELVES.movies]: false,
  [UPCOMING_SHELVES.shows]: false,
  [UPCOMING_SHELVES.documentaries]: true,
} as const satisfies Record<UpcomingShelf, boolean>

type UpcomingCardProps = {
  title: UpcomingTitle
  /** The shelf it sits on, which says whether the card names its kind. */
  shelf: UpcomingShelf
  /** How wide the poster shows, as the layout it sits in lays it out. */
  sizes?: string
}

/**
 * A title still to come, as a library's poster card: its poster, its name and
 * the day it comes out. raven holds no page for it, so the card opens TMDB's
 * in a new tab.
 */
export const UpcomingCard = ({ title, shelf, sizes = POSTER_SIZES.row }: UpcomingCardProps) => {
  const facts = [
    formatAirDate(title.released),
    SHOWS_KIND[shelf] ? COMING_SOON_COPY.kinds[title.type] : null,
  ].filter((fact): fact is string => fact != null)
  return (
    <li className={styles.card}>
      <a
        href={tmdbTitleUrl(title)}
        className={styles.link}
        target="_blank"
        rel="noreferrer"
        aria-label={COMING_SOON_COPY.onTmdb(title.title)}
      >
        <span className={styles.frame}>
          <img
            {...api.tmdbPosterSources(title.poster)}
            sizes={sizes}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </span>
        <span className={styles.title}>{title.title}</span>
      </a>
      <span className={styles.facts}>
        {facts.map((fact) => (
          <span key={fact} className={styles.fact}>
            {fact}
          </span>
        ))}
      </span>
    </li>
  )
}
