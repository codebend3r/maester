import {
  UPCOMING_SHELVES,
  type UpcomingShelf,
  type UpcomingTitle,
  formatAirDate,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { requestsQuery } from '@/lib/queries'
import { COMING_SOON_COPY, comingSoonTitlePath } from '@/pages/ComingSoonPage/copy'
import { REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { requestOf } from '@/pages/ComingSoonPage/titleRequests'
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
 * A title still to come, as a library's poster card: its poster, its name,
 * the day it comes out, and where its request stands once someone made one.
 * It opens the title's own page, where it can be requested.
 */
export const UpcomingCard = ({ title, shelf, sizes = POSTER_SIZES.row }: UpcomingCardProps) => {
  const facts = [
    formatAirDate(title.released),
    SHOWS_KIND[shelf] ? COMING_SOON_COPY.kinds[title.type] : null,
  ].filter((fact): fact is string => fact != null)
  const { data: list } = useQuery(requestsQuery)
  const request = requestOf({ list, ask: title })
  return (
    <li className={styles.card}>
      <Link to={comingSoonTitlePath(title)} className={styles.link}>
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
      </Link>
      <span className={styles.facts}>
        {facts.map((fact) => (
          <span key={fact} className={styles.fact}>
            {fact}
          </span>
        ))}
      </span>
      {request !== null && (
        <span className={styles.status} data-status={request.status}>
          {REQUEST_STATUS_COPY[request.status].label}
        </span>
      )}
    </li>
  )
}
