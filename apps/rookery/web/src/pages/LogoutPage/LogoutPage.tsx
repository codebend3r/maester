import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { signOut } from '@/lib/api'
import { browser } from '@/lib/browser'
import styles from './LogoutPage.module.scss'

/**
 * Apps link here to sign out, since the session cookie is rookery's to
 * clear. The sign-out itself is a same-origin POST, so another site cannot
 * sign someone out with a link.
 */
export const LogoutPage = () => {
  const [params] = useSearchParams()
  const returnTo = params.get('return_to')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    signOut({ returnTo }).then(
      (destination) => browser.goTo(destination),
      () => setFailed(true),
    )
  }, [returnTo])

  return (
    <Frame>
      <h1 className={styles.title}>Signing out</h1>
      {failed ? (
        <p role="alert" className={styles.error}>
          rookery could not sign you out. <Link to="/">Try again from the start.</Link>
        </p>
      ) : (
        <p className={styles.lede}>One moment.</p>
      )}
    </Frame>
  )
}
