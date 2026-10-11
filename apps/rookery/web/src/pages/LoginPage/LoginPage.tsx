import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { AuthError, startSignIn } from '@/lib/api'
import { browser } from '@/lib/browser'
import styles from './LoginPage.module.scss'

/** What went wrong, keyed by the `error` the server puts on `/login`, or by `AuthError.code`. */
export const ERROR_MESSAGES: Record<string, string> = {
  not_approved: 'Plex did not confirm the sign-in. Try again, and approve it on the Plex page.',
  expired: 'That sign-in ran out of time, or was started in another browser. Try again.',
  plex_unavailable: 'Plex is not answering right now. Try again in a minute.',
  unreachable: 'rookery could not start the sign-in. Try again.',
}

/**
 * Sign in with Plex in the same tab: the server opens a PIN, the browser goes
 * to Plex to approve it, and Plex sends it back to rookery's callback, which
 * carries on to `return_to`.
 */
export const LoginPage = () => {
  const [params] = useSearchParams()
  const returnTo = params.get('return_to')
  const [error, setError] = useState(params.get('error'))
  const [busy, setBusy] = useState(false)

  const begin = () => {
    setBusy(true)
    setError(null)
    startSignIn({ returnTo }).then(
      (authUrl) => browser.goTo(authUrl),
      (failure: unknown) => {
        setBusy(false)
        setError(failure instanceof AuthError ? failure.code : 'unreachable')
      },
    )
  }

  const message = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unreachable) : null

  return (
    <Frame>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.lede}>
        One sign-in for luwin and the rest of maester, with your Plex account.
      </p>
      {!!message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
      <button type="button" className={styles.plex} onClick={begin} disabled={busy}>
        {busy ? 'Opening Plex…' : 'Sign in with Plex'}
      </button>
    </Frame>
  )
}
