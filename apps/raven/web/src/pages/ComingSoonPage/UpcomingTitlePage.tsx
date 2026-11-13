import {
  formatAirDate,
  isTitleRequestAsk,
  type TitleRequestAsk,
  UPCOMING_TITLE_PARAMS,
  type UpcomingDetails,
} from '@raven/core'
import { QueryView } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useParams } from 'react-router-dom'
import { BackButton } from '@/components/BackButton/BackButton'
import { Loading } from '@/components/Skeleton/Skeleton'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { upcomingDetailsQuery } from '@/lib/queries'
import { tmdbTitleUrl } from '@/lib/tmdbLinks'
import { APP_PATHS } from '@/lib/appPaths'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { RequestControl } from '@/pages/ComingSoonPage/RequestControl'
import styles from '@/pages/ComingSoonPage/UpcomingTitlePage.module.scss'

const BACK_TO_COMING_SOON = { to: APP_PATHS.comingSoon, label: COMING_SOON_COPY.title } as const

type TitleDetailsProps = {
  /** The title as the address names it, which is all a request sends. */
  ask: TitleRequestAsk
  details: UpcomingDetails
}

/** The title's picture, poster, name, facts, summary and request. */
const TitleDetails = ({ ask, details }: TitleDetailsProps) => {
  const headingId = useId()
  const facts = [
    details.released === null ? null : formatAirDate(details.released),
    COMING_SOON_COPY.kinds[details.type],
    details.runtime === null ? null : COMING_SOON_COPY.minutes(details.runtime),
    ...details.genres,
  ].filter((fact): fact is string => fact !== null)
  return (
    <article className={styles.title} aria-labelledby={headingId}>
      {details.backdrop !== null && (
        <img
          className={styles.backdrop}
          src={api.tmdbBackdropUrl(details.backdrop)}
          alt=""
          decoding="async"
        />
      )}
      <span className={styles.poster}>
        {details.poster !== null && (
          <img
            {...api.tmdbPosterSources(details.poster)}
            sizes={POSTER_SIZES.row}
            alt=""
            decoding="async"
          />
        )}
      </span>
      <div className={styles.details}>
        <h1 id={headingId} className={styles.heading}>
          {details.title}
        </h1>
        {details.tagline !== null && <p className={styles.tagline}>{details.tagline}</p>}
        <ul className={styles.facts}>
          {facts.map((fact) => (
            <li key={fact} className={styles.fact}>
              {fact}
            </li>
          ))}
        </ul>
        <RequestControl ask={ask} />
        {details.summary !== null && <p className={styles.summary}>{details.summary}</p>}
        <a className={styles.tmdb} href={tmdbTitleUrl(details)} target="_blank" rel="noreferrer">
          {COMING_SOON_COPY.viewOnTmdb}
        </a>
      </div>
    </article>
  )
}

type UpcomingTitleProps = { ask: TitleRequestAsk }

const UpcomingTitle = ({ ask }: UpcomingTitleProps) => {
  const details = useQuery(upcomingDetailsQuery(ask))
  return (
    <QueryView
      query={details}
      pending={
        <Loading label={COMING_SOON_COPY.loading}>
          <span className={styles.standIn} />
        </Loading>
      }
      renderFailed={(error) => (
        <p className={styles.message} role="alert">
          {error.message}
        </p>
      )}
    >
      {(data) => <TitleDetails ask={ask} details={data} />}
    </QueryView>
  )
}

/**
 * `/coming-soon/<type>/<tmdbId>`: a movie or show that is still to come, as
 * TMDB describes it, with the button that asks for it to be downloaded for
 * everyone, or where that request stands.
 */
export const UpcomingTitlePage = () => {
  const params = useParams()
  const ask = {
    type: params[UPCOMING_TITLE_PARAMS.type],
    tmdbId: params[UPCOMING_TITLE_PARAMS.tmdbId],
  }
  return (
    <section className={styles.page}>
      <BackButton fallback={BACK_TO_COMING_SOON} className={styles.back} />
      {isTitleRequestAsk(ask) && <UpcomingTitle key={`${ask.type}-${ask.tmdbId}`} ask={ask} />}
      {!isTitleRequestAsk(ask) && <p className={styles.message}>{COMING_SOON_COPY.notFound}</p>}
      <TmdbCredit />
    </section>
  )
}
