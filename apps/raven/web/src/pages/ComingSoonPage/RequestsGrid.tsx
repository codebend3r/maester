import {
  type AppPath,
  type RequestStatus,
  type TitleRequest,
  type TitleRequests,
  addedRequestsOf,
  formatAirDate,
  isLibraryRequest,
  pendingRequestsOf,
  requestKeyOf,
} from '@raven/core'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TmdbPoster } from '@/components/PosterImage/PosterImage'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { CARD_PICTURES } from '@/lib/cardPictures'
import { POSTER_SIZES } from '@/lib/posters'
import { requestsQuery, upcomingDetailsQuery } from '@/lib/queries'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { requestPathOf } from '@/pages/ComingSoonPage/requestPath'
import {
  REQUESTS_STATES,
  type RequestsState,
  requestsStateOf,
} from '@/pages/ComingSoonPage/requestsState'
import styles from '@/pages/ComingSoonPage/RequestsGrid.module.scss'
import cardStyles from '@/pages/ComingSoonPage/UpcomingCard.module.scss'

const requestedOn = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

type RequestCardProps = { request: TitleRequest }

/** What a tab of requests is: which of the caller's it holds, its words, its card, and whether it says what is left today. */
type RequestsPlan = {
  pick: (list: TitleRequests | undefined) => TitleRequest[]
  copy: { none: string; list: string }
  Card: ComponentType<RequestCardProps>
  hasBudget: boolean
}

type RequestsViewProps = {
  query: UseQueryResult<TitleRequests>
  copy: RequestsPlan['copy']
  /** The posters, rendered by the tab's own card. */
  cards: ReactNode
}

const Reading = () => (
  <Loading label={COMING_SOON_COPY.requests.reading}>
    <ul className={styles.grid}>
      <SkeletonCards picture={CARD_PICTURES.poster} count={8} />
    </ul>
  </Loading>
)

const Failed = ({ query }: RequestsViewProps) => (
  <p className={styles.message} role="alert">
    {COMING_SOON_COPY.requests.failed}
    {query.error?.message ?? ''}
  </p>
)

const Nothing = ({ copy }: RequestsViewProps) => <p className={styles.message}>{copy.none}</p>

/** Where a card leads and what it says under its facts. */
type CardStanding = {
  to: AppPath
  status: string
  /** The download's status, which the card colours a note by; null for a request in a library. */
  tone: RequestStatus | null
}

type PosterCardProps = RequestCardProps & CardStanding

/**
 * One request as a poster card: TMDB's poster, read from the title's own
 * details, its name, its kind, the day it comes out and the day it was
 * asked for, then where it stands.
 */
const PosterCard = ({ request, to, status, tone }: PosterCardProps) => {
  const { data: details } = useQuery(upcomingDetailsQuery(request))
  const poster = details?.poster ?? null
  const released = details?.released ?? null
  const facts = [
    COMING_SOON_COPY.kinds[request.type],
    released === null ? null : formatAirDate(released),
    COMING_SOON_COPY.requests.requestedOn(requestedOn.format(new Date(request.requestedAt))),
  ].filter((fact): fact is string => fact != null)
  return (
    <li className={cardStyles.card}>
      <Link to={to} className={cardStyles.link}>
        <span className={cardStyles.frame}>
          {poster !== null && <TmdbPoster poster={poster} sizes={POSTER_SIZES.grid} />}
        </span>
        <span className={cardStyles.title}>{request.title}</span>
      </Link>
      <span className={cardStyles.facts}>
        {facts.map((fact) => (
          <span key={fact} className={cardStyles.fact}>
            {fact}
          </span>
        ))}
      </span>
      <span className={cardStyles.status} data-status={tone ?? undefined}>
        {status}
      </span>
    </li>
  )
}

/** A request no library holds yet says how far its download got. */
const onItsWay = (request: TitleRequest): CardStanding => ({
  to: requestPathOf(request),
  status: REQUEST_STATUS_COPY[request.status].label,
  tone: request.status,
})

/** An added request says it is in the library, or stands as one on its way while its download moves there. */
const addedStanding = (request: TitleRequest): CardStanding => {
  if (!isLibraryRequest(request)) return onItsWay(request)
  return {
    to: requestPathOf(request),
    status: COMING_SOON_COPY.requests.added.status,
    tone: null,
  }
}

const PendingCard = ({ request }: RequestCardProps) => (
  <PosterCard request={request} {...onItsWay(request)} />
)

const AddedCard = ({ request }: RequestCardProps) => (
  <PosterCard request={request} {...addedStanding(request)} />
)

const Listed = ({ copy, cards }: RequestsViewProps) => (
  <ul className={styles.grid} aria-label={copy.list}>
    {cards}
  </ul>
)

const REQUESTS_VIEWS = {
  [REQUESTS_STATES.reading]: Reading,
  [REQUESTS_STATES.failed]: Failed,
  [REQUESTS_STATES.none]: Nothing,
  [REQUESTS_STATES.listed]: Listed,
} as const satisfies Record<RequestsState, ComponentType<RequestsViewProps>>

const PENDING_PLAN = {
  pick: pendingRequestsOf,
  copy: COMING_SOON_COPY.requests.pending,
  Card: PendingCard,
  hasBudget: true,
} as const satisfies RequestsPlan

const ADDED_PLAN = {
  pick: addedRequestsOf,
  copy: COMING_SOON_COPY.requests.added,
  Card: AddedCard,
  hasBudget: false,
} as const satisfies RequestsPlan

type RequestsGridProps = { plan: RequestsPlan }

/** The titles on their way for the caller that a tab holds, newest first, as a grid of posters. */
const RequestsGrid = ({ plan }: RequestsGridProps) => {
  const query = useQuery(requestsQuery)
  const shown = plan.pick(query.data)
  const View = REQUESTS_VIEWS[requestsStateOf({ query, count: shown.length })]
  const cards = shown.map((request) => <plan.Card key={requestKeyOf(request)} request={request} />)
  return (
    <div className={styles.panel}>
      {plan.hasBudget && query.data && (
        <p className={styles.budget}>{REQUEST_COPY.left(query.data.budget)}</p>
      )}
      <View query={query} copy={plan.copy} cards={cards} />
    </div>
  )
}

/** Coming soon's Pending tab: the caller's requests and the titles the downloaders hold that are still on their way, each saying where it stands, under how many requests are left today. */
export const PendingRequests = () => <RequestsGrid plan={PENDING_PLAN} />

/** Coming soon's Added tab: the same titles once they are in a library, each opening the title there, or downloaded and moving into one. */
export const AddedRequests = () => <RequestsGrid plan={ADDED_PLAN} />
