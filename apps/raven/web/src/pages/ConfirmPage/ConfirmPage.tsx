import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { AuthCard, Lead, Status } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { AUTH_QUERY, AUTH_ROUTES, HOME_PATH } from '@/lib/authRoutes'
import { useAuthSession } from '@/stores/authSession'
import styles from '@/pages/ConfirmPage/ConfirmPage.module.scss'

export const CONFIRM_TYPES = { email: 'email', recovery: 'recovery' } as const
type ConfirmType = (typeof CONFIRM_TYPES)[keyof typeof CONFIRM_TYPES]

/** Where each kind of link leads once spent, and how to ask for a new one. */
const LINK_TYPES = {
  [CONFIRM_TYPES.email]: {
    destination: HOME_PATH,
    resend: { to: AUTH_ROUTES.checkEmail, label: 'Send a new confirmation link' },
  },
  [CONFIRM_TYPES.recovery]: {
    destination: AUTH_ROUTES.reset,
    resend: { to: AUTH_ROUTES.forgot, label: 'Send a new reset link' },
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

const Verifying = () => <AuthCard title="Confirming your link" lead={<Status>One moment</Status>} />

const Expired = ({ type }: { type: ConfirmType | null }) => {
  const again = type === null ? null : LINK_TYPES[type].resend

  return (
    <AuthCard
      title="This link has expired or was already used"
      lead={
        <Lead>
          {again === null
            ? 'Sign in, and ask for a new link from there if you need one.'
            : 'Links work once, for a short time. Ask for a new one.'}
        </Lead>
      }
    >
      <nav className={styles.actions} aria-label="Next steps">
        {again !== null && <Link to={again.to}>{again.label}</Link>}
        <Link to={AUTH_ROUTES.signIn}>Back to sign in</Link>
      </nav>
    </AuthCard>
  )
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

  // The same route stays mounted, so the link read above survives the move.
  if (search !== '') return <Navigate replace to={AUTH_ROUTES.confirm} />

  if (link.kind === LINK_KINDS.valid && outcome === OUTCOMES.verified && hasSession) {
    return <Navigate replace to={LINK_TYPES[link.type].destination} />
  }

  return (
    <AuthScreen audience={AUDIENCES.anyone}>
      {link.kind === LINK_KINDS.valid && outcome !== OUTCOMES.failed ? (
        <Verifying />
      ) : (
        <Expired type={link.type} />
      )}
    </AuthScreen>
  )
}
