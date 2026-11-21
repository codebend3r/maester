import {
  UPCOMING_SHELVES,
  type UpcomingShelf,
  type UpcomingTitle,
  formatAirDate,
  requestOf,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { TmdbPoster } from '@/components/PosterImage/PosterImage'
import { POSTER_SIZES } from '@/lib/posters'
import { requestHoldingQuery, requestsQuery } from '@/lib/queries'
import { comingSoonTitlePath } from '@/lib/appPaths'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import styles from '@/pages/ComingSoonPage/UpcomingCard.module.scss'

/** Whether a shelf's cards say if each is a movie or a show: only where it holds both. */
const SHOWS_KIND = {
  [UPCOMING_SHELVES.movies]: false,
  [UPCOMING_SHELVES.shows]: false,
  [UPCOMING_SHELVES.documentaries]: true,
  [UPCOMING_SHELVES.anime]: true,
} as const satisfies Record<UpcomingShelf, boolean>

type UpcomingCardProps = {
  title: UpcomingTitle
  /** The shelf it sits on, which says whether the card names its kind. */
  shelf: UpcomingShelf
}

/**
 * A title still to come, as a library's poster card: its poster, its name,
 * the day it comes out, and where its request stands once someone made one.
 * A title requested through raven, or that its Sonarr or Radarr holds
 * already, wears a green check in the poster's corner. It opens the title's
 * own page, where it can be requested.
 */
export const UpcomingCard = ({ title, shelf }: UpcomingCardProps) => {
  const facts = [
    formatAirDate(title.released),
    SHOWS_KIND[shelf] ? COMING_SOON_COPY.kinds[title.type] : null,
  ].filter((fact): fact is string => fact != null)
  const { data: list } = useQuery(requestsQuery)
  const request = requestOf({ list, ask: title })
  // A card reads its holding once; the title's own page keeps it fresh.
  const { data: holding } = useQuery({ ...requestHoldingQuery(title), refetchInterval: false })
  const isRequested = request !== null || (holding?.status ?? null) !== null
  return (
    <li className={styles.card}>
      <Link to={comingSoonTitlePath(title)} className={styles.link}>
        <span className={styles.frame}>
          <TmdbPoster poster={title.poster} sizes={POSTER_SIZES.row} />
          {isRequested && (
            <span className={styles.marks}>
              <span className={styles.requested}>
                <Icon name="check" size={14} />
                <span className="visually-hidden">{REQUEST_COPY.requestedMark}</span>
              </span>
            </span>
          )}
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
