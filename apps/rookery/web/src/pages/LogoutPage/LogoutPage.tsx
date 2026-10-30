import { type ComponentType, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { signOut } from '@/lib/api'
import { browser } from '@/lib/browser'
import { ROUTES, QUERY_PARAMS } from '@/lib/routes'
import styles from '@/pages/LogoutPage/LogoutPage.module.scss'
import { LOGOUT_PAGE_COPY } from '@/pages/LogoutPage/copy'

const LOGOUT_STATES = { pending: 'pending', failed: 'failed' } as const

type LogoutState = (typeof LOGOUT_STATES)[keyof typeof LOGOUT_STATES]

const LogoutPending = () => <p className={styles.lede}>{LOGOUT_PAGE_COPY.pending}</p>

const LogoutFailed = () => (
  <p role="alert" className={styles.error}>
    {LOGOUT_PAGE_COPY.failed} <Link to={ROUTES.home}>{LOGOUT_PAGE_COPY.tryAgain}</Link>
  </p>
)

const LOGOUT_VIEWS = {
  [LOGOUT_STATES.pending]: LogoutPending,
  [LOGOUT_STATES.failed]: LogoutFailed,
} as const satisfies Record<LogoutState, ComponentType>

/**
 * Apps link here to sign out, since the session cookie is rookery's to
 * clear. The sign-out itself is a same-origin POST, so another site cannot
 * sign someone out with a link.
 */
export const LogoutPage = () => {
  const [params] = useSearchParams()
  const returnTo = params.get(QUERY_PARAMS.returnTo)
  const [state, setState] = useState<LogoutState>(LOGOUT_STATES.pending)

  useEffect(() => {
    signOut({ returnTo }).then(
      (destination) => browser.goTo(destination),
      () => setState(LOGOUT_STATES.failed),
    )
  }, [returnTo])

  const View = LOGOUT_VIEWS[state]

  return (
    <Frame>
      <h1 className={styles.title}>{LOGOUT_PAGE_COPY.title}</h1>
      <View />
    </Frame>
  )
}
