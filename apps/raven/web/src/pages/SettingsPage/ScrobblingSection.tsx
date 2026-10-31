import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AUTH_CONFIG_STATES,
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
import { authConfigQuery, scrobblingQuery } from '@/lib/queries'
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

/**
 * Where Last.fm's sign-in comes back to: Settings on the web address the
 * server names for raven, which is the one it accepts, else on this page's.
 */
const useLastFmReturn = (): string => {
  const config = useQuery(authConfigQuery).data
  const webUrl = config?.state === AUTH_CONFIG_STATES.ready ? config.webUrl : window.location.origin
  return `${webUrl}${SCROBBLE_RETURNS.web}`
}

/** ListenBrainz's user token, sent once and never shown: the field empties as it is sent. */
const ListenBrainzLink = () => {
  const tokenId = useId()
  const [token, setToken] = useState('')
  const keep = useKeepStatuses()
  const link = useMutation({
    mutationFn: (sent: string) => api.linkListenBrainz({ token: sent }),
    onSuccess: keep,
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

/** Last.fm's Connect, which leaves for Last.fm's sign-in page; it comes back to Settings. */
const LastFmLink = () => {
  const returnTo = useLastFmReturn()
  const start = useMutation({
    mutationFn: () => api.startLastFm({ returnTo }),
    onSuccess: ({ url }) => window.location.assign(url),
  })
  return (
    <div className={scrobblingStyles.connect}>
      <Button disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? COPY.connecting : COPY.connect}
      </Button>
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

type ServiceViewProps = { status: ScrobbleStatus }

/** A service the server has no keys for. */
const NotSetUp = ({ status }: ServiceViewProps) => (
  <p className={styles.hint}>{COPY.notSetUp(SERVICE_NAMES[status.service])}</p>
)

/** A linked service: the account's name there, and Unlink. */
const Linked = ({ status }: ServiceViewProps) => {
  const keep = useKeepStatuses()
  const unlink = useMutation({
    mutationFn: () => api.unlinkScrobbling({ service: status.service }),
    onSuccess: keep,
  })
  return (
    <div className={scrobblingStyles.connect}>
      <p>{COPY.linkedAs(status.username ?? '')}</p>
      <Button
        disabled={unlink.isPending}
        aria-label={COPY.unlinkService(SERVICE_NAMES[status.service])}
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

/** A service the account may link: its hint, and the way to link it. */
const Unlinked = ({ status }: ServiceViewProps) => {
  const Linker = LINKERS[status.service]
  return (
    <>
      <p className={styles.hint}>{SERVICE_HINTS[status.service]}</p>
      <Linker />
    </>
  )
}

const SERVICE_STATES = { notSetUp: 'notSetUp', linked: 'linked', unlinked: 'unlinked' } as const

type ServiceState = (typeof SERVICE_STATES)[keyof typeof SERVICE_STATES]

const SERVICE_VIEWS = {
  [SERVICE_STATES.notSetUp]: NotSetUp,
  [SERVICE_STATES.linked]: Linked,
  [SERVICE_STATES.unlinked]: Unlinked,
} as const satisfies Record<ServiceState, ComponentType<ServiceViewProps>>

const stateOf = (status: ScrobbleStatus): ServiceState => {
  if (!status.isAvailable) return SERVICE_STATES.notSetUp
  return status.username === null ? SERVICE_STATES.unlinked : SERVICE_STATES.linked
}

/** One service on a card of its own: its name, then where the account stands with it. */
const Service = ({ status }: ServiceViewProps) => {
  const View = SERVICE_VIEWS[stateOf(status)]
  return (
    <li className={scrobblingStyles.service}>
      <h3 className={styles.subheading}>{SERVICE_NAMES[status.service]}</h3>
      <View status={status} />
    </li>
  )
}

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
