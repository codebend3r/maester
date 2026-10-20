import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
import { AuthCard, Brand, Lead, Status } from '@/components/AuthScreen/AuthCard'
import { PosterWall } from '@/components/AuthScreen/PosterWall'
import { type AccessKind, ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { HOME_PATH, signInPath } from '@/lib/authRoutes'
import styles from '@/components/AuthScreen/AuthScreen.module.scss'

/** Who an auth page is for. Anyone else is sent where they belong. */
export const AUDIENCES = {
  /** Sign in, sign up, check email and forgot password. */
  signedOut: 'signedOut',
  /** An email link, which works whoever opens it, and the new password it leads to. */
  anyone: 'anyone',
  /** An account waiting for approval, or whose access was removed. */
  waiting: 'waiting',
} as const

type Audience = (typeof AUDIENCES)[keyof typeof AUDIENCES]

/** Where the server has answered about the visitor; loading, failures and accounts off are the screen's own. */
type Answered = Extract<
  AccessKind,
  | typeof ACCESS_KINDS.signedOut
  | typeof ACCESS_KINDS.pending
  | typeof ACCESS_KINDS.revoked
  | typeof ACCESS_KINDS.approved
>

const ADMITTED: Record<Audience, readonly Answered[]> = {
  [AUDIENCES.signedOut]: [ACCESS_KINDS.signedOut],
  [AUDIENCES.anyone]: [
    ACCESS_KINDS.signedOut,
    ACCESS_KINDS.pending,
    ACCESS_KINDS.revoked,
    ACCESS_KINDS.approved,
  ],
  [AUDIENCES.waiting]: [ACCESS_KINDS.pending, ACCESS_KINDS.revoked],
}

/** Where a visitor a page does not admit belongs. */
const destinationOf = ({ kind, approvedTo }: { kind: Answered; approvedTo: string }): string => {
  switch (kind) {
    case ACCESS_KINDS.signedOut:
      return signInPath({ returnTo: HOME_PATH })
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
      return AUTH_ROUTES.pending
    case ACCESS_KINDS.approved:
      return approvedTo
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

const Frame = ({ children }: { children: ReactNode }) => (
  <div className={styles.page}>
    <PosterWall />
    <main className={styles.side}>{children}</main>
  </div>
)

const Waiting = () => (
  <section className={styles.card}>
    <Brand />
    <Status>Checking your account</Status>
  </section>
)

const Unavailable = () => (
  <AuthCard
    title="Sign in is temporarily unavailable"
    lead={<Lead>raven could not reach its accounts. Try again in a moment.</Lead>}
  />
)

/**
 * The screen every page of the auth flow sits in, beside the poster wall.
 * While accounts are off the page is not there; while they cannot be
 * reached it says so instead of showing a form that cannot work. Otherwise
 * it shows `children` to its `audience` and sends anyone else on: to sign
 * in, to the pending page, or, once approved, to `approvedTo`.
 */
export const AuthScreen = ({
  audience,
  approvedTo = HOME_PATH,
  children,
}: {
  audience: Audience
  approvedTo?: string
  children: ReactNode
}) => {
  const access = useAccessState()

  switch (access.kind) {
    case ACCESS_KINDS.disabled:
      return <Navigate replace to={HOME_PATH} />
    case ACCESS_KINDS.loading:
      return (
        <Frame>
          <Waiting />
        </Frame>
      )
    case ACCESS_KINDS.unavailable:
    case ACCESS_KINDS.failed:
      return (
        <Frame>
          <Unavailable />
        </Frame>
      )
    case ACCESS_KINDS.signedOut:
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
    case ACCESS_KINDS.approved:
      return ADMITTED[audience].some((kind) => kind === access.kind) ? (
        <Frame>{children}</Frame>
      ) : (
        <Navigate replace to={destinationOf({ kind: access.kind, approvedTo })} />
      )
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}
