import { PAGE_PATHS, QUERY_PARAMS } from '@rookery/core'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { signOut } from '@/lib/api'
import { browser } from '@/lib/browser'
import { LOGOUT_PAGE_COPY } from '@/pages/LogoutPage/copy'
import text from '@/styles/text.module.scss'

const LOGOUT_STATES = { pending: 'pending', failed: 'failed' } as const

type LogoutState = (typeof LOGOUT_STATES)[keyof typeof LOGOUT_STATES]

const LogoutPending = () => <p className={text.lede}>{LOGOUT_PAGE_COPY.pending}</p>

const LogoutFailed = () => (
  <p role="alert" className={text.error}>
    {LOGOUT_PAGE_COPY.failed} <Link to={PAGE_PATHS.home}>{LOGOUT_PAGE_COPY.tryAgain}</Link>
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
  // StrictMode runs an effect twice in development; the sign-out is a write, so it goes once.
  const hasSignedOut = useRef(false)

  useEffect(() => {
    if (hasSignedOut.current) return
    hasSignedOut.current = true
    signOut({ returnTo }).then(
      (destination) => browser.goTo(destination),
      () => setState(LOGOUT_STATES.failed),
    )
  }, [returnTo])

  const View = LOGOUT_VIEWS[state]

  return (
    <Frame>
      <h1 className={text.title}>{LOGOUT_PAGE_COPY.title}</h1>
      <View />
    </Frame>
  )
}
