import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { AUTH_QUERY, AUTH_ROUTES, HOME_PATH } from '@/lib/authRoutes'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import { useAuthSession } from '@/stores/authSession'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'
import styles from '@/pages/ConfirmPage/ConfirmPage.module.scss'

export const CONFIRM_TYPES = { email: 'email', recovery: 'recovery' } as const
type ConfirmType = (typeof CONFIRM_TYPES)[keyof typeof CONFIRM_TYPES]

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

const destinationOf = (type: ConfirmType): string => {
  switch (type) {
    case CONFIRM_TYPES.email:
      return HOME_PATH
    case CONFIRM_TYPES.recovery:
      return AUTH_ROUTES.reset
    default: {
      const unreachable: never = type
      return unreachable
    }
  }
}

const Verifying = () => (
  <section className={signInStyles.form}>
    <Brand />
    <header className={signInStyles.welcome}>
      <h1 className={signInStyles.title}>Confirming your link</h1>
      <output className={signInStyles.lead}>One moment</output>
    </header>
  </section>
)

const RESEND_LINKS = {
  [CONFIRM_TYPES.email]: { to: AUTH_ROUTES.checkEmail, label: 'Send a new confirmation link' },
  [CONFIRM_TYPES.recovery]: { to: AUTH_ROUTES.forgot, label: 'Send a new reset link' },
} as const satisfies Record<ConfirmType, { to: string; label: string }>

const Expired = ({ type }: { type: ConfirmType | null }) => {
  const again = type === null ? null : RESEND_LINKS[type]

  return (
    <section className={signInStyles.form}>
      <Brand />
      <header className={signInStyles.welcome}>
        <h1 className={signInStyles.title}>This link has expired or was already used</h1>
        <p className={signInStyles.lead}>
          {again === null
            ? 'Sign in, and ask for a new link from there if you need one.'
            : 'Links work once, for a short time. Ask for a new one.'}
        </p>
      </header>
      <nav className={styles.actions} aria-label="Next steps">
        {again !== null && <Link to={again.to}>{again.label}</Link>}
        <Link to={AUTH_ROUTES.signIn}>Back to sign in</Link>
      </nav>
    </section>
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
  const navigate = useNavigate()
  const client = useAuthSession((state) => state.client)
  const hasSession = useAuthSession((state) => state.session !== null)
  const isDisabled = useAccessState().kind === ACCESS_KINDS.disabled
  const [outcome, setOutcome] = useState<Outcome>(OUTCOMES.verifying)
  const hasVerified = useRef(false)

  // With accounts off the screen sends the visitor home, which clears the URL too.
  useEffect(() => {
    if (search === '' || isDisabled) return
    navigate(AUTH_ROUTES.confirm, { replace: true })
  }, [search, isDisabled, navigate])

  useEffect(() => {
    if (link.kind !== LINK_KINDS.valid || client === null || search !== '') return
    // A token works once: no re-run of this effect may spend it again.
    if (hasVerified.current) return
    hasVerified.current = true
    client.verifyOtp({ token_hash: link.tokenHash, type: link.type }).then(
      ({ data, error }) =>
        setOutcome(error || data.session === null ? OUTCOMES.failed : OUTCOMES.verified),
      () => setOutcome(OUTCOMES.failed),
    )
  }, [link, client, search])

  if (link.kind === LINK_KINDS.valid && outcome === OUTCOMES.verified && hasSession) {
    return <Navigate replace to={destinationOf(link.type)} />
  }

  return (
    <AuthScreen shouldKeepVisitor>
      {link.kind === LINK_KINDS.valid && outcome !== OUTCOMES.failed ? (
        <Verifying />
      ) : (
        <Expired type={link.type} />
      )}
    </AuthScreen>
  )
}
