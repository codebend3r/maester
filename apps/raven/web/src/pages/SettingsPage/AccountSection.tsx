import { useId } from 'react'
import type { Account } from '@raven/core'
import { Button } from '@raven/ui'
import { useSignOut } from '@/lib/useSignOut'
import { STATUS_NAMES } from '@/pages/SettingsPage/memberStatus'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import accountStyles from '@/pages/SettingsPage/AccountSection.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type AccountSectionProps = { account: Account }

/** Who is signed in, and the way out. */
export const AccountSection = ({ account }: AccountSectionProps) => {
  const headingId = useId()
  const end = useSignOut()

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon="check">{COMMON_COPY.account}</Titled>
        </h2>
        <p className={styles.help}>{SETTINGS_COPY.account.help}</p>
      </header>
      <div className={accountStyles.account}>
        <dl className={accountStyles.facts}>
          <dt>{SETTINGS_COPY.account.email}</dt>
          <dd>{account.email}</dd>
          <dt>{SETTINGS_COPY.account.access}</dt>
          <dd>{STATUS_NAMES[account.status]}</dd>
        </dl>
        <Button
          className={accountStyles.signOut}
          disabled={end.isPending}
          onClick={() => end.mutate()}
        >
          {end.isPending ? COMMON_COPY.signingOut : COMMON_COPY.signOut}
        </Button>
      </div>
      {end.isError && (
        <p className={styles.error} role="alert">
          {SETTINGS_COPY.account.signOutFailed}
          {end.error.message}
        </p>
      )}
    </section>
  )
}
