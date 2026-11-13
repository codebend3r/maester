import { QUERY_PARAMS } from '@rookery/core'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { AUTH_ERRORS, AuthError, type AuthErrorCode, isAuthErrorCode, startSignIn } from '@/lib/api'
import { browser } from '@/lib/browser'
import styles from '@/pages/LoginPage/LoginPage.module.scss'
import { ERROR_MESSAGES, LOGIN_PAGE_COPY } from '@/pages/LoginPage/copy'
import text from '@/styles/text.module.scss'

/** The `error` on `/login`, which anyone can type; a code rookery does not know reads as `unreachable`. */
const errorIn = (value: string | null): AuthErrorCode | null => {
  if (!value) return null
  return isAuthErrorCode(value) ? value : AUTH_ERRORS.unreachable
}

/**
 * Sign in with Plex in the same tab: the server opens a PIN, the browser goes
 * to Plex to approve it, and Plex sends it back to rookery's callback, which
 * carries on to `return_to`.
 */
export const LoginPage = () => {
  const [params] = useSearchParams()
  const returnTo = params.get(QUERY_PARAMS.returnTo)
  const [error, setError] = useState(errorIn(params.get(QUERY_PARAMS.error)))
  const [busy, setBusy] = useState(false)

  const begin = () => {
    setBusy(true)
    setError(null)
    startSignIn({ returnTo }).then(
      (authUrl) => browser.goTo(authUrl),
      (failure: unknown) => {
        setBusy(false)
        setError(failure instanceof AuthError ? failure.code : AUTH_ERRORS.unreachable)
      },
    )
  }

  const message = error ? ERROR_MESSAGES[error] : null

  return (
    <Frame>
      <h1 className={text.title}>{LOGIN_PAGE_COPY.title}</h1>
      <p className={text.lede}>{LOGIN_PAGE_COPY.lede}</p>
      {!!message && (
        <p role="alert" className={`${text.error} ${styles.errorBox}`}>
          {message}
        </p>
      )}
      <button type="button" className={styles.plex} onClick={begin} disabled={busy}>
        {busy ? LOGIN_PAGE_COPY.opening : LOGIN_PAGE_COPY.signIn}
      </button>
    </Frame>
  )
}
