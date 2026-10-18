import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Logo } from '@/components/Logo/Logo'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { AUTH_ROUTES, HOME_PATH } from '@/lib/authRoutes'
import { PosterWall } from '@/pages/SignInPage/PosterWall'
import styles from '@/pages/SignInPage/SignInPage.module.scss'

export const Brand = () => (
  <span className={styles.brand}>
    <Logo />
  </span>
)

const Frame = ({ children }: { children: ReactNode }) => (
  <div className={styles.page}>
    <PosterWall />
    <main className={styles.side}>{children}</main>
  </div>
)

const Waiting = () => (
  <section className={styles.form}>
    <Brand />
    <output className={styles.lead}>Checking your account</output>
  </section>
)

const Unavailable = () => (
  <section className={styles.form}>
    <Brand />
    <header className={styles.welcome}>
      <h1 className={styles.title}>Sign in is temporarily unavailable</h1>
      <p className={styles.lead}>raven could not reach its accounts. Try again in a moment.</p>
    </header>
  </section>
)

/**
 * The screen every signed out page of the auth flow sits in, beside the poster
 * wall. While accounts are off the page is not there; a visitor already in is
 * sent on, to `approvedTo` once approved; while accounts cannot be reached it
 * says so instead of showing a form that cannot work. `children` is the form.
 */
export const AuthScreen = ({
  approvedTo = HOME_PATH,
  children,
}: {
  approvedTo?: string
  children: ReactNode
}) => {
  const access = useAccessState()

  switch (access.kind) {
    case ACCESS_KINDS.disabled:
      return <Navigate replace to={HOME_PATH} />
    case ACCESS_KINDS.approved:
      return <Navigate replace to={approvedTo} />
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
      return <Navigate replace to={AUTH_ROUTES.pending} />
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
      return <Frame>{children}</Frame>
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}
