import { SETTINGS_COPY } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/lib/queries'
import { queryClient } from '@/lib/queryClient'
import { signOut } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'
import { toastFailure } from '@/stores/toast'
import { BUTTON_VARIANTS, Button } from '@/ui/Button/Button'
import { Card } from '@/ui/Card/Card'
import styles from '@/screens/Settings/AccountCard.module.scss'

/** Ends the session; the routes then land on sign-in. A sign-out that fails says why. */
const leave = (): void => {
  signOut({ queryClient }).catch(toastFailure)
}

/**
 * The account signed in: its initial on a red disc, its email, and Sign out, which ends the
 * session, after which the routes land on sign-in. The email is the server's `/api/me`, so the
 * card shows Sign out at once and the email as it is read. A server with accounts off has
 * nobody signed in, and no card.
 */
export function AccountCard() {
  const userId = useAuthSession((state) => state.session?.userId ?? null)
  const account = useQuery(queries.accountQuery(userId))
  const email = account.data?.email ?? ''
  return (
    userId !== null && (
      <Card className={styles.card}>
        <span aria-hidden="true" className={styles.avatar}>
          {email.charAt(0).toUpperCase()}
        </span>
        <p className={styles.name}>{email}</p>
        <Button label={SETTINGS_COPY.signOut} onPress={leave} variant={BUTTON_VARIANTS.ghost} />
      </Card>
    )
  )
}
