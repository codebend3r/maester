import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { AuthCard, Lead, Status } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { AUTH_QUERY, HOME_PATH } from '@/lib/authRoutes'
import { useAuthSession } from '@/stores/authSession'
import { CONFIRM_COPY } from '@/pages/ConfirmPage/copy'
import styles from '@/pages/ConfirmPage/ConfirmPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

export const CONFIRM_TYPES = { email: 'email', recovery: 'recovery' } as const
type ConfirmType = (typeof CONFIRM_TYPES)[keyof typeof CONFIRM_TYPES]

/** Where each kind of link leads once spent, and how to ask for a new one. */
const LINK_TYPES = {
  [CONFIRM_TYPES.email]: {
    destination: HOME_PATH,
    resend: { to: AUTH_ROUTES.checkEmail, label: CONFIRM_COPY.newConfirmationLink },
  },
  [CONFIRM_TYPES.recovery]: {
    destination: AUTH_ROUTES.reset,
    resend: { to: AUTH_ROUTES.forgot, label: CONFIRM_COPY.newResetLink },
  },
} as const satisfies Record<
  ConfirmType,
  { destination: string; resend: { to: string; label: string } }
>

const isConfirmType = (value: unknown): value is ConfirmType =>
  Object.values(CONFIRM_TYPES).some((type) => type === value)

const LINK_KINDS = { valid: 'valid', invalid: 'invalid' } as const

/** What the email link carried; read once, because the URL is cleared at once. */
type ConfirmLink =
  | { kind: typeof LINK_KINDS.valid; tokenHash: string; type: ConfirmType }
  | { kind: typeof LINK_KINDS.invalid; type: ConfirmType | null }

const linkOf = (params: URLSearchParams): ConfirmLink => {
  const type = params.get(AUTH_QUERY.type)
  const tokenHash = params.get(AUTH_QUERY.tokenHash) ?? ''
  if (!isConfirmType(type)) return { kind: LINK_KINDS.invalid, type: null }
  if (tokenHash === '') return { kind: LINK_KINDS.invalid, type }
  return { kind: LINK_KINDS.valid, tokenHash, type }
}

const OUTCOMES = { verifying: 'verifying', verified: 'verified', failed: 'failed' } as const
type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES]

const Verifying = () => (
  <AuthCard
    title={CONFIRM_COPY.verifyingTitle}
    lead={<Status>{CONFIRM_COPY.verifyingLead}</Status>}
  />
)

type ExpiredProps = { type: ConfirmType | null }

const Expired = ({ type }: ExpiredProps) => {
  const again = type === null ? null : LINK_TYPES[type].resend

  return (
    <AuthCard
      title={CONFIRM_COPY.expiredTitle}
      lead={
        <Lead>{again === null ? CONFIRM_COPY.expiredSignIn : CONFIRM_COPY.expiredAskAgain}</Lead>
      }
    >
      <nav className={styles.actions} aria-label={CONFIRM_COPY.nextSteps}>
        {again !== null && <Link to={again.to}>{again.label}</Link>}
        <Link to={AUTH_ROUTES.signIn}>{COMMON_COPY.backToSignIn}</Link>
      </nav>
    </AuthCard>
  )
}

const CARD_KEYS = { verifying: 'verifying', expired: 'expired' } as const

type CardProps = {
  [CARD_KEYS.verifying]: Record<never, never>
  [CARD_KEYS.expired]: ExpiredProps
}

const CARDS = {
  [CARD_KEYS.verifying]: Verifying,
  [CARD_KEYS.expired]: Expired,
} as const satisfies ViewsOf<CardProps>

type ConfirmScreenProps = { card: ViewOf<CardProps> }

/** The screen stays mounted while the wait gives way to the dead end. */
const ConfirmScreen = ({ card }: ConfirmScreenProps) => (
  <AuthScreen audience={AUDIENCES.anyone}>
    <KeyedView<CardProps> views={CARDS} view={card} />
  </AuthScreen>
)

type LeaveProps = { to: string }

const Leave = ({ to }: LeaveProps) => <Navigate replace to={to} />

const CONFIRM_VIEW_KEYS = { clearing: 'clearing', leaving: 'leaving', screen: 'screen' } as const

type ConfirmViewProps = {
  [CONFIRM_VIEW_KEYS.clearing]: LeaveProps
  [CONFIRM_VIEW_KEYS.leaving]: LeaveProps
  [CONFIRM_VIEW_KEYS.screen]: ConfirmScreenProps
}

const CONFIRM_VIEWS = {
  [CONFIRM_VIEW_KEYS.clearing]: Leave,
  [CONFIRM_VIEW_KEYS.leaving]: Leave,
  [CONFIRM_VIEW_KEYS.screen]: ConfirmScreen,
} as const satisfies ViewsOf<ConfirmViewProps>

type ConfirmViewOfProps = {
  search: string
  link: ConfirmLink
  outcome: Outcome
  hasSession: boolean
}

/** Which view the page shows: the URL being cleared, the way on, or the screen with the wait or the dead end. */
const confirmViewOf = ({
  search,
  link,
  outcome,
  hasSession,
}: ConfirmViewOfProps): ViewOf<ConfirmViewProps> => {
  // The same route stays mounted, so the link read on mounting survives the move.
  if (search !== '') return { key: CONFIRM_VIEW_KEYS.clearing, props: { to: AUTH_ROUTES.confirm } }
  if (link.kind === LINK_KINDS.valid && outcome === OUTCOMES.verified && hasSession)
    return { key: CONFIRM_VIEW_KEYS.leaving, props: { to: LINK_TYPES[link.type].destination } }
  if (link.kind === LINK_KINDS.valid && outcome !== OUTCOMES.failed)
    return {
      key: CONFIRM_VIEW_KEYS.screen,
      props: { card: { key: CARD_KEYS.verifying, props: {} } },
    }
  return {
    key: CONFIRM_VIEW_KEYS.screen,
    props: { card: { key: CARD_KEYS.expired, props: { type: link.type } } },
  }
}

/**
 * `/auth/confirm?token_hash=&type=`: where the confirmation and recovery
 * emails land. A token works once, so the page takes it off the URL before
 * anything else and spends it exactly once, however often React runs the
 * effect. It leaves only when the store holds the new session, or the gate
 * would send the visitor to sign in. A visitor already in stays until the
 * link is spent.
 */
export const ConfirmPage = () => {
  const [params] = useSearchParams()
  const [link] = useState(() => linkOf(params))
  const { search } = useLocation()
  const client = useAuthSession((state) => state.client)
  const hasSession = useAuthSession((state) => state.session !== null)
  const [outcome, setOutcome] = useState<Outcome>(OUTCOMES.verifying)
  const hasVerified = useRef(false)

  useEffect(() => {
    if (link.kind !== LINK_KINDS.valid || client === null || search !== '') return
    if (hasVerified.current) return
    hasVerified.current = true
    client.verifyOtp({ token_hash: link.tokenHash, type: link.type }).then(
      ({ data, error }) =>
        setOutcome(error || data.session === null ? OUTCOMES.failed : OUTCOMES.verified),
      () => setOutcome(OUTCOMES.failed),
    )
  }, [link, client, search])

  return (
    <KeyedView<ConfirmViewProps>
      views={CONFIRM_VIEWS}
      view={confirmViewOf({ search, link, outcome, hasSession })}
    />
  )
}
