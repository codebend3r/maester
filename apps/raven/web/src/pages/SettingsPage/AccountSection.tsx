import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { Button } from '@raven/ui'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { signOut } from '@/lib/signOut'
import { STATUS_NAMES } from '@/pages/SettingsPage/memberStatus'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/**
 * Who is signed in, and the way out. Shown only while accounts are on and
 * the viewer is approved, since the other states have a screen of their own.
 */
export const AccountSection = () => {
  const headingId = useId()
  const queryClient = useQueryClient()
  const access = useAccessState()
  const end = useMutation({ mutationFn: () => signOut({ queryClient }) })
  if (access.kind !== ACCESS_KINDS.approved) return null
  const { account } = access

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon="check">Account</Titled>
        </h2>
        <p className={styles.help}>The account this browser is signed in to.</p>
      </header>
      <div className={styles.account}>
        <dl className={styles.facts}>
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>Access</dt>
          <dd>{STATUS_NAMES[account.status]}</dd>
        </dl>
        <Button className={styles.signOut} disabled={end.isPending} onClick={() => end.mutate()}>
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
