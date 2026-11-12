import type { TitleRequest, TitleRequestAsk, TitleRequests } from '@raven/core'
import { Button } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { api } from '@/lib/api'
import { requestsQuery } from '@/lib/queries'
import styles from '@/pages/ComingSoonPage/RequestControl.module.scss'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { requestOf } from '@/pages/ComingSoonPage/titleRequests'

/** What the control shows: nothing yet, requests off, the request made, the budget spent, or the button. */
const REQUEST_CONTROL_STATES = {
  loading: 'loading',
  off: 'off',
  requested: 'requested',
  spent: 'spent',
  open: 'open',
} as const

type RequestControlState = (typeof REQUEST_CONTROL_STATES)[keyof typeof REQUEST_CONTROL_STATES]

type RequestViewProps = {
  ask: TitleRequestAsk
  list: TitleRequests | undefined
  request: TitleRequest | null
}

/** Which view the control shows, from the requests as the server last answered them. */
const controlStateOf = ({ ask, list, request }: RequestViewProps): RequestControlState => {
  if (list === undefined) return REQUEST_CONTROL_STATES.loading
  if (request !== null) return REQUEST_CONTROL_STATES.requested
  if (!list.kinds[ask.type]) return REQUEST_CONTROL_STATES.off
  if (list.budget.left === 0) return REQUEST_CONTROL_STATES.spent
  return REQUEST_CONTROL_STATES.open
}

const Loading = () => null

const Off = ({ ask }: RequestViewProps) => (
  <p className={styles.note}>{REQUEST_COPY.off[ask.type]}</p>
)

type RequestStandingProps = { request: TitleRequest }

/** Where a request stands, and whose it was. */
const RequestStanding = ({ request }: RequestStandingProps) => {
  const status = REQUEST_STATUS_COPY[request.status]
  return (
    <>
      <output className={styles.status} data-status={request.status}>
        {status.label}
      </output>
      <p className={styles.note}>{status.line}</p>
      <p className={styles.note}>
        {request.isMine ? REQUEST_COPY.requestedByYou : REQUEST_COPY.requestedBySomeone}
      </p>
    </>
  )
}

const Requested = ({ request }: RequestViewProps) =>
  request !== null && <RequestStanding request={request} />

const Spent = ({ list }: RequestViewProps) => (
  <>
    <Button tone="primary" size="large" icon="download" disabled>
      {REQUEST_COPY.request}
    </Button>
    {list !== undefined && (
      <p className={styles.note}>
        {REQUEST_COPY.spent(list.budget.limit)}{' '}
        {list.budget.nextAt !== null && REQUEST_COPY.nextAt(list.budget.nextAt)}
      </p>
    )}
  </>
)

const Open = ({ ask, list }: RequestViewProps) => {
  const queryClient = useQueryClient()
  const request = useMutation({
    mutationFn: () => api.requestDownload(ask),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
  })
  return (
    <>
      <Button
        tone="primary"
        size="large"
        icon="download"
        disabled={request.isPending}
        onClick={() => request.mutate()}
      >
        {request.isPending ? REQUEST_COPY.requesting : REQUEST_COPY.request}
      </Button>
      {list !== undefined && <p className={styles.note}>{REQUEST_COPY.left(list.budget)}</p>}
      <p className={styles.note}>{REQUEST_COPY.explain}</p>
      {request.isError && (
        <p className={styles.error} role="alert">
          {REQUEST_COPY.failed} {request.error.message}
        </p>
      )}
    </>
  )
}

const REQUEST_VIEWS = {
  [REQUEST_CONTROL_STATES.loading]: Loading,
  [REQUEST_CONTROL_STATES.off]: Off,
  [REQUEST_CONTROL_STATES.requested]: Requested,
  [REQUEST_CONTROL_STATES.spent]: Spent,
  [REQUEST_CONTROL_STATES.open]: Open,
} as const satisfies Record<RequestControlState, ComponentType<RequestViewProps>>

type RequestControlProps = { ask: TitleRequestAsk }

/**
 * Asks for an upcoming title to be downloaded for everyone, or says where
 * the request someone made stands. One request a title, so once it is made
 * the button is gone for every account.
 */
export const RequestControl = ({ ask }: RequestControlProps) => {
  const { data: list } = useQuery(requestsQuery)
  const request = requestOf({ list, ask })
  const View = REQUEST_VIEWS[controlStateOf({ ask, list, request })]
  return (
    <section className={styles.control} aria-label={REQUEST_COPY.heading}>
      <View ask={ask} list={list} request={request} />
    </section>
  )
}
