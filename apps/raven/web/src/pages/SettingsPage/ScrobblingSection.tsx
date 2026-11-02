import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SCROBBLE_OUTCOMES,
  SCROBBLE_PARAMS,
  SCROBBLE_RETURNS,
  SCROBBLE_SERVICES,
  type ScrobbleService,
  type ScrobbleStatus,
  oneOf,
} from '@raven/core'
import { Button } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { type ComponentType, type FormEvent, useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { scrobblingQuery } from '@/lib/queries'
import { useIsDesktop } from '@/stores/desktop'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import scrobblingStyles from '@/pages/SettingsPage/ScrobblingSection.module.scss'

const COPY = SETTINGS_COPY.scrobbling

const SERVICE_NAMES = {
  [SCROBBLE_SERVICES.listenBrainz]: COPY.listenBrainz,
  [SCROBBLE_SERVICES.lastFm]: COPY.lastFm,
} as const satisfies Record<ScrobbleService, string>

const SERVICE_HINTS = {
  [SCROBBLE_SERVICES.listenBrainz]: COPY.listenBrainzHint,
  [SCROBBLE_SERVICES.lastFm]: COPY.lastFmHint,
} as const satisfies Record<ScrobbleService, string>

type ScrobbleOutcome = (typeof SCROBBLE_OUTCOMES)[keyof typeof SCROBBLE_OUTCOMES]

const isScrobbleOutcome = oneOf(Object.values(SCROBBLE_OUTCOMES))

const OUTCOME_WORDS = {
  [SCROBBLE_OUTCOMES.linked]: COPY.linked,
  [SCROBBLE_OUTCOMES.failed]: COPY.failed,
} as const satisfies Record<ScrobbleOutcome, string>

/** Keeps the services as the server now says they stand, from a link or an unlink. */
const useKeepStatuses = () => {
  const queryClient = useQueryClient()
  return (statuses: ScrobbleStatus[]) => queryClient.setQueryData(queryKeys.scrobbling, statuses)
}

/** ListenBrainz's user token, sent once and never shown: the field empties as it is sent. */
const ListenBrainzLink = () => {
  const tokenId = useId()
  const [token, setToken] = useState('')
  const keep = useKeepStatuses()
  const link = useMutation({
    mutationFn: (sent: string) => api.linkListenBrainz({ token: sent }),
    onSuccess: keep,
    // The token rides in the mutation's variables, so the cache lets it go as soon as it settles.
    gcTime: 0,
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    link.mutate(token.trim())
    setToken('')
  }
  return (
    <form className={scrobblingStyles.token} onSubmit={submit}>
      <label htmlFor={tokenId} className={scrobblingStyles.tokenLabel}>
        {COPY.token}
      </label>
      <input
        id={tokenId}
        type="password"
        className={scrobblingStyles.tokenInput}
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <Button
        type="submit"
        className={scrobblingStyles.tokenSubmit}
        disabled={link.isPending || token.trim() === ''}
      >
        {link.isPending ? COPY.linking : COPY.link}
      </Button>
      {link.isError && (
        <p className={`${styles.error} ${scrobblingStyles.tokenError}`} role="alert">
          {COPY.linkFailed}
          {link.error.message}
        </p>
      )}
    </form>
  )
}

/**
 * Last.fm's Connect, which leaves for Last.fm's sign-in page; it comes back
 * to Settings on the web address the server knows, which a page inside
 * Raven or on a LAN address cannot name for itself. Raven hands Last.fm's page
 * to the system browser, so it says where to finish; the statuses read again
 * as the window comes back into focus.
 */
const LastFmLink = () => {
  const isDesktop = useIsDesktop()
  const start = useMutation({
    mutationFn: () => api.startLastFm({ returnTo: SCROBBLE_RETURNS.web }),
    onSuccess: ({ url }) => window.location.assign(url),
  })
  return (
    <div className={scrobblingStyles.connect}>
      <Button disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? COPY.connecting : COPY.connect}
      </Button>
      {isDesktop && start.isSuccess && (
        <output className={styles.status}>{COPY.finishInBrowser}</output>
      )}
      {start.isError && (
        <p className={styles.error} role="alert">
          {COPY.connectFailed}
          {start.error.message}
        </p>
      )}
    </div>
  )
}

const LINKERS = {
  [SCROBBLE_SERVICES.listenBrainz]: ListenBrainzLink,
  [SCROBBLE_SERVICES.lastFm]: LastFmLink,
} as const satisfies Record<ScrobbleService, ComponentType>

const SERVICE_STATES = { notSetUp: 'notSetUp', linked: 'linked', unlinked: 'unlinked' } as const

/** Where the account stands with a service, its name there read only once it is linked. */
type ServiceStanding =
  | { state: typeof SERVICE_STATES.notSetUp; service: ScrobbleService }
  | { state: typeof SERVICE_STATES.linked; service: ScrobbleService; username: string }
  | { state: typeof SERVICE_STATES.unlinked; service: ScrobbleService }

type ServiceState = (typeof SERVICE_STATES)[keyof typeof SERVICE_STATES]

/** Each state's standing, by its state. */
type StandingIn = { [State in ServiceState]: Extract<ServiceStanding, { state: State }> }

type StandingViewProps<State extends ServiceState> = { standing: StandingIn[State] }

type NotSetUpProps = StandingViewProps<typeof SERVICE_STATES.notSetUp>

/** A service the server has no keys for. */
const NotSetUp = ({ standing }: NotSetUpProps) => (
  <p className={styles.hint}>{COPY.notSetUp(SERVICE_NAMES[standing.service])}</p>
)

type LinkedProps = StandingViewProps<typeof SERVICE_STATES.linked>

/** A linked service: the account's name there, and Unlink. */
const Linked = ({ standing: { service, username } }: LinkedProps) => {
  const keep = useKeepStatuses()
  const unlink = useMutation({
    mutationFn: () => api.unlinkScrobbling({ service }),
    onSuccess: keep,
  })
  return (
    <div className={scrobblingStyles.connect}>
      <p>{COPY.linkedAs(username)}</p>
      <Button
        disabled={unlink.isPending}
        aria-label={COPY.unlinkService(SERVICE_NAMES[service])}
        onClick={() => unlink.mutate()}
      >
        {COPY.unlink}
      </Button>
      {unlink.isError && (
        <p className={styles.error} role="alert">
          {COPY.unlinkFailed}
          {unlink.error.message}
        </p>
      )}
    </div>
  )
}

type UnlinkedProps = StandingViewProps<typeof SERVICE_STATES.unlinked>

/** A service the account may link: its hint, and the way to link it. */
const Unlinked = ({ standing: { service } }: UnlinkedProps) => {
  const Linker = LINKERS[service]
  return (
    <>
      <p className={styles.hint}>{SERVICE_HINTS[service]}</p>
      <Linker />
    </>
  )
}

type StandingOfProps = ScrobbleStatus

const standingOf = ({ service, isAvailable, username }: StandingOfProps): ServiceStanding => {
  if (!isAvailable) return { state: SERVICE_STATES.notSetUp, service }
  if (username === null) return { state: SERVICE_STATES.unlinked, service }
  return { state: SERVICE_STATES.linked, service, username }
}

/** Each state's view, which takes that state's standing, so a linked one reads its username as text. */
type StandingViews = { [State in ServiceState]: ComponentType<StandingViewProps<State>> }

const STANDING_VIEWS = {
  [SERVICE_STATES.notSetUp]: NotSetUp,
  [SERVICE_STATES.linked]: Linked,
  [SERVICE_STATES.unlinked]: Unlinked,
} as const satisfies StandingViews

type StandingProps<State extends ServiceState> = { standing: StandingIn[State] & { state: State } }

/** Where the account stands with a service, by the view its state keys. */
const Standing = <State extends ServiceState>({ standing }: StandingProps<State>) => {
  // Read through the mapped type, which ties each state to its own view's props.
  const views: StandingViews = STANDING_VIEWS
  const View: ComponentType<StandingViewProps<State>> = views[standing.state]
  return <View standing={standing} />
}

type ServiceProps = { status: ScrobbleStatus }

/** One service on a card of its own: its name, then where the account stands with it. */
const Service = ({ status }: ServiceProps) => (
  <li className={scrobblingStyles.service}>
    <h3 className={styles.subheading}>{SERVICE_NAMES[status.service]}</h3>
    <Standing standing={standingOf(status)} />
  </li>
)

/**
 * How Last.fm's sign-in went, read once from `?scrobbling=` as it comes
 * back, then taken out of the address so a refresh does not say it again.
 */
const useLastFmOutcome = (): ScrobbleOutcome | null => {
  const [params, setParams] = useSearchParams()
  const said = params.get(SCROBBLE_PARAMS.outcome)
  const [outcome] = useState<ScrobbleOutcome | null>(() => (isScrobbleOutcome(said) ? said : null))
  const isInAddress = said !== null
  useEffect(() => {
    if (!isInAddress) return
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(SCROBBLE_PARAMS.outcome)
        return next
      },
      { replace: true },
    )
  }, [isInAddress, setParams])
  return outcome
}

/** The services the account forwards its listens to: linking each, and unlinking it. */
export const ScrobblingSection = () => {
  const headingId = useId()
  const scrobbling = useQuery(scrobblingQuery)
  const outcome = useLastFmOutcome()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon="headphones">{COPY.heading}</Titled>
        </h2>
        <p className={styles.help}>{COPY.help}</p>
      </header>
      {outcome !== null && <output className={styles.status}>{OUTCOME_WORDS[outcome]}</output>}
      {scrobbling.isError && (
        <p className={styles.error} role="alert">
          {scrobbling.error.message}
        </p>
      )}
      {scrobbling.isPending && (
        <Loading label={COPY.reading}>
          <Bone shape="heading" />
          <Bone shape="heading" />
        </Loading>
      )}
      {scrobbling.data && (
        <ul className={scrobblingStyles.services}>
          {scrobbling.data.map((status) => (
            <Service key={status.service} status={status} />
          ))}
        </ul>
      )}
    </section>
  )
}
