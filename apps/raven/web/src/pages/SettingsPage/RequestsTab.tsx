import type { TitleRequest, TitleRequests } from '@raven/core'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type ComponentType, useId } from 'react'
import { Link } from 'react-router-dom'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { requestsQuery } from '@/lib/queries'
import { COMING_SOON_COPY, comingSoonTitlePath } from '@/pages/ComingSoonPage/copy'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/RequestsTab.module.scss'
import settingsStyles from '@/pages/SettingsPage/SettingsPage.module.scss'

const requestedOn = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const REQUEST_COLUMNS = {
  title: 'title',
  kind: 'kind',
  requested: 'requested',
  status: 'status',
} as const

const COLUMNS = Object.values(REQUEST_COLUMNS)

/** The columns that fold away as the table narrows, so their headers fold with them. */
const HEAD_CLASSES: Partial<Record<(typeof COLUMNS)[number], string>> = {
  [REQUEST_COLUMNS.kind]: styles.kind,
}

/** What the tab shows: the requests still being read, a failed read, none made yet, or the table. */
const REQUESTS_STATES = {
  reading: 'reading',
  failed: 'failed',
  none: 'none',
  listed: 'listed',
} as const

type RequestsState = (typeof REQUESTS_STATES)[keyof typeof REQUESTS_STATES]

type RequestsViewProps = { query: UseQueryResult<TitleRequests>; mine: readonly TitleRequest[] }

type StateOfProps = RequestsViewProps

const stateOf = ({ query, mine }: StateOfProps): RequestsState => {
  if (query.isPending) return REQUESTS_STATES.reading
  if (query.isError) return REQUESTS_STATES.failed
  return mine.length === 0 ? REQUESTS_STATES.none : REQUESTS_STATES.listed
}

const Reading = () => (
  <Loading label={SETTINGS_COPY.requests.reading}>
    <Bone shape="heading" />
    <Bone shape="heading" />
  </Loading>
)

const Failed = ({ query }: RequestsViewProps) => (
  <p className={settingsStyles.error} role="alert">
    {SETTINGS_COPY.requests.failed}
    {query.error?.message ?? ''}
  </p>
)

const Nothing = () => <p className={settingsStyles.hint}>{SETTINGS_COPY.requests.none}</p>

type RequestRowProps = { request: TitleRequest }

const RequestRow = ({ request }: RequestRowProps) => (
  <tr>
    <th scope="row" className={styles.title}>
      <Link to={comingSoonTitlePath(request)}>{request.title}</Link>
    </th>
    <td className={styles.kind}>{COMING_SOON_COPY.kinds[request.type]}</td>
    <td className={styles.when}>
      <time dateTime={request.requestedAt}>
        {requestedOn.format(new Date(request.requestedAt))}
      </time>
    </td>
    <td>
      <span className={styles.status} data-status={request.status}>
        {REQUEST_STATUS_COPY[request.status].label}
      </span>
    </td>
  </tr>
)

const Listed = ({ mine }: RequestsViewProps) => (
  <div className={styles.room}>
    <table className={styles.table} aria-label={SETTINGS_COPY.requests.table}>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column} scope="col" className={HEAD_CLASSES[column]}>
              {SETTINGS_COPY.requests.columns[column]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {mine.map((request) => (
          <RequestRow key={`${request.type}:${request.tmdbId}`} request={request} />
        ))}
      </tbody>
    </table>
  </div>
)

const REQUESTS_VIEWS = {
  [REQUESTS_STATES.reading]: Reading,
  [REQUESTS_STATES.failed]: Failed,
  [REQUESTS_STATES.none]: Nothing,
  [REQUESTS_STATES.listed]: Listed,
} as const satisfies Record<RequestsState, ComponentType<RequestsViewProps>>

/** The caller's own requests: one request covers everyone, so only those the caller made are listed. */
export const mineOf = (list: TitleRequests | undefined): TitleRequest[] =>
  list?.requests.filter((request) => request.isMine) ?? []

/**
 * Settings' Requests tab: every title the caller asked Coming soon to
 * download, newest first, with when they asked and where it stands now, read
 * again from Sonarr or Radarr as the list refreshes.
 */
export const RequestsTab = () => {
  const headingId = useId()
  const query = useQuery(requestsQuery)
  const mine = mineOf(query.data)
  const View = REQUESTS_VIEWS[stateOf({ query, mine })]
  return (
    <section className={settingsStyles.section} aria-labelledby={headingId}>
      <header className={settingsStyles.sectionHead}>
        <h2 id={headingId} className={settingsStyles.heading}>
          <Titled icon="download">{SETTINGS_COPY.requests.heading}</Titled>
        </h2>
        <p className={settingsStyles.help}>{SETTINGS_COPY.requests.help}</p>
        {query.data && (
          <p className={settingsStyles.hint}>{REQUEST_COPY.left(query.data.budget)}</p>
        )}
      </header>
      <View query={query} mine={mine} />
    </section>
  )
}
