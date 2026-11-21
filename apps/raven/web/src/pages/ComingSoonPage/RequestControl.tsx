import {
  REQUEST_STATES,
  type RequestStanding,
  type RequestState,
  type TitleRequestAsk,
  type TitleRequests,
  requestStandingOf,
  requestStateOf,
} from '@raven/core'
import { BUTTON_TONES, Button, Icon } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ComponentType, useId } from 'react'
import { api } from '@/lib/api'
import { requestHoldingQuery, requestsQuery } from '@/lib/queries'
import styles from '@/pages/ComingSoonPage/RequestControl.module.scss'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { useRequester } from '@/pages/ComingSoonPage/useRequester'

const requestedDay = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

type RequestViewProps = {
  ask: TitleRequestAsk
  list: TitleRequests | undefined
  standing: RequestStanding | null
}

const Loading = () => null

const Off = ({ ask }: RequestViewProps) => (
  <p className={styles.note}>{REQUEST_COPY.off[ask.type]}</p>
)

type StandingNoteProps = RequestStanding & { ask: TitleRequestAsk }

/**
 * Where the title stands, who asked for it and on which day, under the
 * button greyed out: a title asked for once, or that its arr holds, is never
 * asked for again, so the button can not send it.
 */
const StandingNote = ({ ask, status, request }: StandingNoteProps) => {
  const copy = REQUEST_STATUS_COPY[status]
  const who = useRequester({ ask, request })
  const lineId = useId()
  return (
    <>
      <span className={styles.standing}>
        <Button tone={BUTTON_TONES.primary} size="large" icon="check" disabled>
          {REQUEST_COPY.requested}
        </Button>
        <span className={styles.status} data-status={status}>
          <button
            type="button"
            className={styles.info}
            aria-label={REQUEST_COPY.aboutStatus}
            aria-describedby={lineId}
          >
            <Icon name="info" size="1.25em" />
          </button>
          <span id={lineId} role="tooltip" className={styles.tooltip}>
            {copy.line}
          </span>
          <output>{copy.label}</output>
        </span>
      </span>
      <p className={styles.note}>
        {request === null
          ? REQUEST_COPY.requestedBy(who)
          : REQUEST_COPY.requestedByOn({
              who,
              day: requestedDay.format(new Date(request.requestedAt)),
            })}
      </p>
    </>
  )
}

const Requested = ({ ask, standing }: RequestViewProps) =>
  standing !== null && <StandingNote ask={ask} {...standing} />

const Spent = ({ list }: RequestViewProps) => (
  <>
    <Button tone={BUTTON_TONES.primary} size="large" icon="download" disabled>
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
        tone={BUTTON_TONES.primary}
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
  [REQUEST_STATES.loading]: Loading,
  [REQUEST_STATES.off]: Off,
  [REQUEST_STATES.requested]: Requested,
  [REQUEST_STATES.spent]: Spent,
  [REQUEST_STATES.open]: Open,
} as const satisfies Record<RequestState, ComponentType<RequestViewProps>>

type RequestControlProps = { ask: TitleRequestAsk }

/**
 * Asks for an upcoming title to be downloaded for everyone, or says where
 * the request someone made stands. One request a title, so once it is made,
 * or once the title's arr holds it, the button is gone for every account.
 */
export const RequestControl = ({ ask }: RequestControlProps) => {
  const { data: list } = useQuery(requestsQuery)
  const { data: holding, isPending: isHoldingPending } = useQuery(requestHoldingQuery(ask))
  const standing = requestStandingOf({ list, ask, holding })
  const View = REQUEST_VIEWS[requestStateOf({ ask, list, standing, isReading: isHoldingPending })]
  return (
    <section className={styles.control} aria-label={REQUEST_COPY.heading}>
      <View ask={ask} list={list} standing={standing} />
    </section>
  )
}
