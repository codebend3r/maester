import { useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import { useQueryClient } from '@tanstack/react-query'
import { ACCOUNT_ANSWERS, accountKey, useAccountActions } from '@/renderer/desktop/accountApi'
import styles from '@/renderer/Account/AccountRefused.module.scss'
import { Refusal } from '@/renderer/Account/Refusal'
import { ACCOUNT_STATES, type AccountView, isAccountView } from '@/shared/protocol'

type RefusedState = typeof ACCOUNT_STATES.pending | typeof ACCOUNT_STATES.revoked

const TITLES = {
  [ACCOUNT_STATES.pending]: 'Waiting for approval',
  [ACCOUNT_STATES.revoked]: 'Your access was removed',
} as const satisfies Record<RefusedState, string>

const REASONS = {
  [ACCOUNT_STATES.pending]: 'The owner of this server has not approved',
  [ACCOUNT_STATES.revoked]: 'The owner of this server removed access for',
} as const satisfies Record<RefusedState, string>

const STILL = {
  [ACCOUNT_STATES.pending]: 'Not approved yet.',
  [ACCOUNT_STATES.revoked]: 'Your access is still removed.',
} as const satisfies Record<RefusedState, string>

const BECAME = {
  [ACCOUNT_STATES.pending]: 'Your account is now waiting for approval.',
  [ACCOUNT_STATES.revoked]: 'Your access has been removed.',
} as const satisfies Record<RefusedState, string>

const isRefusedState = (state: AccountView['state']): state is RefusedState =>
  state === ACCOUNT_STATES.pending || state === ACCOUNT_STATES.revoked

/** What Check again found: the same refusal, another one, or nothing to say once let in. */
const statusAfter = ({ was, is }: { was: RefusedState; is: AccountView['state'] }): string => {
  if (!isRefusedState(is)) return ''
  return is === was ? STILL[is] : BECAME[is]
}

/**
 * A server that signed the person in but does not let them in: waiting on its owner, or removed
 * by it. Check again asks main to read the account anew; a change re-renders whoever holds the
 * account query, so this only says when nothing changed.
 */
export const AccountRefused = ({
  serverId,
  state,
  email,
}: {
  serverId: string
  state: RefusedState
  /** The signed in person's email, as the account view gives it. */
  email: string | null
}) => {
  const { refresh, signOut } = useAccountActions()
  const queryClient = useQueryClient()
  const titleId = useId()
  const [status, setStatus] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const isCheckingNow = useRef(false)

  const checkAgain = async () => {
    if (isCheckingNow.current) return
    isCheckingNow.current = true
    setIsChecking(true)
    // Emptied first: a live region announces a change, so the same text twice needs a gap.
    setStatus('')
    setRefusal(null)
    const answer = await refresh(serverId)
    isCheckingNow.current = false
    setIsChecking(false)
    if (answer.kind === ACCOUNT_ANSWERS.refused) return setRefusal(answer.message)
    // The answer has replaced the account query, which may hold a state other than this one.
    const checked: unknown = queryClient.getQueryData(accountKey(serverId))
    setStatus(statusAfter({ was: state, is: isAccountView(checked) ? checked.state : state }))
  }

  const leave = async () => {
    setStatus('')
    setRefusal(null)
    const answer = await signOut(serverId)
    if (answer.kind === ACCOUNT_ANSWERS.refused) setRefusal(answer.message)
  }

  return (
    <section className={styles.refused} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        {TITLES[state]}
      </h3>
      <p className={styles.reason}>
        {REASONS[state]} {email ?? 'your account'}.
      </p>
      <div className={styles.actions}>
        {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
        <Button aria-disabled={isChecking} onClick={() => void checkAgain()}>
          Check again
        </Button>
        <Button onClick={() => void leave()}>Sign out</Button>
      </div>
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output className={styles.status}>{status}</output>
      {refusal !== null && <Refusal>{refusal}</Refusal>}
    </section>
  )
}
