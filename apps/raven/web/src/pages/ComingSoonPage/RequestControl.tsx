import type {
  RequestStatus,
  TitleHolding,
  TitleRequest,
  TitleRequestAsk,
  TitleRequests,
} from '@raven/core'
import { Button } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { api } from '@/lib/api'
import { requestHoldingQuery, requestsQuery } from '@/lib/queries'
import styles from '@/pages/ComingSoonPage/RequestControl.module.scss'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { requestOf } from '@/pages/ComingSoonPage/titleRequests'

/** What the control shows: nothing yet, requests off, where the title stands, the budget spent, or the button. */
const REQUEST_CONTROL_STATES = {
  loading: 'loading',
  off: 'off',
  requested: 'requested',
  spent: 'spent',
  open: 'open',
} as const

type RequestControlState = (typeof REQUEST_CONTROL_STATES)[keyof typeof REQUEST_CONTROL_STATES]

/** Where a requested title stands, and whose ask put it there. */
type Standing = { status: RequestStatus; whose: string }

type StandingOfProps = { request: TitleRequest | null; holding: TitleHolding | undefined }

/** raven's request for the title, else its arr's holding of it; null while it is free to request. */
const standingOf = ({ request, holding }: StandingOfProps): Standing | null => {
  if (request !== null) {
    const whose = request.isMine ? REQUEST_COPY.requestedByYou : REQUEST_COPY.requestedBySomeone
    return { status: request.status, whose }
  }
  const held = holding?.status ?? null
  return held === null ? null : { status: held, whose: REQUEST_COPY.requestedAlready }
}

type RequestViewProps = {
  ask: TitleRequestAsk
  list: TitleRequests | undefined
  standing: Standing | null
}

type ControlStateOfProps = RequestViewProps & { isReading: boolean }

/** Which view the control shows, from the requests and the title's arr as the server last answered them. */
const controlStateOf = ({
  ask,
  list,
  standing,
  isReading,
}: ControlStateOfProps): RequestControlState => {
  if (list === undefined || isReading) return REQUEST_CONTROL_STATES.loading
  if (standing !== null) return REQUEST_CONTROL_STATES.requested
  if (!list.kinds[ask.type]) return REQUEST_CONTROL_STATES.off
  if (list.budget.left === 0) return REQUEST_CONTROL_STATES.spent
  return REQUEST_CONTROL_STATES.open
}

const Loading = () => null

const Off = ({ ask }: RequestViewProps) => (
  <p className={styles.note}>{REQUEST_COPY.off[ask.type]}</p>
)

/**
 * Where the title stands, and whose ask put it there, under the button
 * greyed out: a title asked for once, or that its arr holds, is never asked
 * for again, so the button can not send it.
 */
const StandingNote = ({ status, whose }: Standing) => {
  const copy = REQUEST_STATUS_COPY[status]
  return (
    <>
      <Button tone="primary" size="large" icon="check" disabled>
        {REQUEST_COPY.requested}
      </Button>
      <output className={styles.status} data-status={status}>
        {copy.label}
      </output>
      <p className={styles.note}>{copy.line}</p>
      <p className={styles.note}>{whose}</p>
    </>
  )
}

const Requested = ({ standing }: RequestViewProps) =>
  standing !== null && <StandingNote {...standing} />

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
 * the request someone made stands. One request a title, so once it is made,
 * or once the title's arr holds it, the button is gone for every account.
 */
export const RequestControl = ({ ask }: RequestControlProps) => {
  const { data: list } = useQuery(requestsQuery)
  const { data: holding, isPending: isHoldingPending } = useQuery(requestHoldingQuery(ask))
  const standing = standingOf({ request: requestOf({ list, ask }), holding })
  const View = REQUEST_VIEWS[controlStateOf({ ask, list, standing, isReading: isHoldingPending })]
  return (
    <section className={styles.control} aria-label={REQUEST_COPY.heading}>
      <View ask={ask} list={list} standing={standing} />
    </section>
  )
}
