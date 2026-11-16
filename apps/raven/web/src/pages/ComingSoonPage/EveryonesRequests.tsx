import type { MemberRequest } from '@raven/core'
import { requestKeyOf } from '@raven/core'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { TmdbPoster } from '@/components/PosterImage/PosterImage'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { everyonesRequestsQuery, upcomingDetailsQuery } from '@/lib/queries'
import { type AccountName, accountNamesOf, useAccounts } from '@/lib/useAccounts'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import styles from '@/pages/ComingSoonPage/EveryonesRequests.module.scss'
import { requestPathOf } from '@/pages/ComingSoonPage/requestPath'
import {
  REQUESTS_STATES,
  type RequestsState,
  requestsStateOf,
} from '@/pages/ComingSoonPage/requestsState'
import { RequestStatusPill } from '@/pages/ComingSoonPage/RequestStatusPill'
import tableStyles from '@/pages/ComingSoonPage/RequestsTable.module.scss'

const COPY = COMING_SOON_COPY.everyone

const requestedAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const COLUMNS = ['title', 'status', 'requestedBy', 'requested'] as const

type EveryoneViewProps = { query: UseQueryResult<MemberRequest[]>; nameOf: AccountName }

const Reading = () => (
  <Loading label={COPY.reading}>
    <Bone shape="heading" />
    <Bone shape="heading" />
  </Loading>
)

const Failed = ({ query }: EveryoneViewProps) => (
  <p className={styles.message} role="alert">
    {COPY.failed}
    {query.error?.message ?? ''}
  </p>
)

const Nothing = () => <p className={styles.message}>{COPY.none}</p>

type RequestRowProps = { request: MemberRequest; nameOf: AccountName }

/** Who put a title on its way: the account that asked, or the downloader that took it on with nobody asking. */
const requesterOf = ({ request, nameOf }: RequestRowProps): string =>
  request.requestedBy === null ? COPY.downloaders[request.type] : nameOf(request.requestedBy)

/** One request as a row: its small poster and name, where it stands, whose it was and when they asked. */
const RequestRow = ({ request, nameOf }: RequestRowProps) => {
  const { data: details } = useQuery(upcomingDetailsQuery(request))
  const poster = details?.poster ?? null
  return (
    <tr>
      <th scope="row">
        <Link to={requestPathOf(request)} className={styles.title}>
          <span className={styles.poster}>
            {poster !== null && <TmdbPoster poster={poster} sizes={POSTER_SIZES.list} />}
          </span>
          {request.title}
        </Link>
      </th>
      <td>
        <RequestStatusPill status={request.status} />
      </td>
      <td className={styles.by}>{requesterOf({ request, nameOf })}</td>
      <td className={styles.when}>
        <time dateTime={request.requestedAt}>
          {requestedAt.format(new Date(request.requestedAt))}
        </time>
      </td>
    </tr>
  )
}

const Listed = ({ query, nameOf }: EveryoneViewProps) => (
  <div className={tableStyles.room}>
    <table className={tableStyles.table} aria-label={COPY.table}>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column} scope="col">
              {COPY.columns[column]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(query.data ?? []).map((request) => (
          <RequestRow key={requestKeyOf(request)} request={request} nameOf={nameOf} />
        ))}
      </tbody>
    </table>
  </div>
)

const EVERYONE_VIEWS = {
  [REQUESTS_STATES.reading]: Reading,
  [REQUESTS_STATES.failed]: Failed,
  [REQUESTS_STATES.none]: Nothing,
  [REQUESTS_STATES.listed]: Listed,
} as const satisfies Record<RequestsState, ComponentType<EveryoneViewProps>>

/**
 * Coming soon's All requests tab, for whoever manages raven: every request
 * any account made and every title still to come the downloaders hold,
 * newest first, as a table of its title beside a small poster, where it
 * stands, whose it was (an account, or Sonarr or Radarr where nobody asked)
 * and when.
 */
export const EveryonesRequests = () => {
  const query = useQuery(everyonesRequestsQuery)
  const nameOf = accountNamesOf({ accounts: useAccounts(), thisServer: COPY.thisServer })
  const View = EVERYONE_VIEWS[requestsStateOf({ query, count: query.data?.length ?? 0 })]
  return <View query={query} nameOf={nameOf} />
}
