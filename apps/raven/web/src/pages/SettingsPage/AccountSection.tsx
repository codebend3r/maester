import { useId } from 'react'
import type { Account } from '@raven/core'
import { Button } from '@raven/ui'
import { useSignOut } from '@/lib/useSignOut'
import { STATUS_NAMES } from '@/pages/SettingsPage/memberStatus'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import accountStyles from '@/pages/SettingsPage/AccountSection.module.scss'

/** Who is signed in, and the way out. */
export const AccountSection = ({ account }: { account: Account }) => {
  const headingId = useId()
  const end = useSignOut()

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon="check">Account</Titled>
        </h2>
        <p className={styles.help}>The account this browser is signed in to.</p>
      </header>
      <div className={accountStyles.account}>
        <dl className={accountStyles.facts}>
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>Access</dt>
          <dd>{STATUS_NAMES[account.status]}</dd>
        </dl>
        <Button
          className={accountStyles.signOut}
          disabled={end.isPending}
          onClick={() => end.mutate()}
        >
          {end.isPending ? 'Signing out' : 'Sign out'}
        </Button>
      </div>
      {end.isError && (
        <p className={styles.error} role="alert">
          Could not sign out: {end.error.message}
        </p>
      )}
    </section>
  )
}
