import { useMutation } from '@tanstack/react-query'
import { ApiError, AUTH_REFUSALS } from '@raven/core'
import { Button } from '@raven/ui'
import { Address, AuthCard, Lead } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { ACCESS_KINDS, useAccessState, useAccount } from '@/lib/accessState'
import { useSignOut } from '@/lib/useSignOut'
import { PENDING_COPY } from '@/pages/PendingPage/copy'
import styles from '@/pages/PendingPage/PendingPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const ANSWERS = [AUTH_REFUSALS.pending, AUTH_REFUSALS.revoked, AUTH_REFUSALS.signedOut]

/** Whether the server answered, even if the answer was no: only a failure to get one is a failed check. */
const isAnswer = (error: Error | null): boolean =>
  error instanceof ApiError && ANSWERS.some((reason) => reason === error.refusal?.reason)

/**
 * `/pending`: where the gate leaves an account that is not approved, waiting
 * or removed, with Check again and Sign out. It sits outside the gate and the
 * browsing frame and reads no library data; the screen sends everyone else
 * where they belong.
 *
 * The page, not the notice, asks for the account and holds the buttons' work,
 * so all of it outlives the notice: a check that finds no account yet empties
 * the answer, and the screen shows the wait in its place. A notice that asked
 * for the account on mounting would ask again each time it came back.
 */
export const PendingPage = () => {
  const access = useAccessState()
  const account = useAccount()
  const check = useMutation({ mutationFn: () => account.refetch() })
  const end = useSignOut()
  const answer = check.data
  const isFailed = !!answer && answer.isError && !isAnswer(answer.error)
  const isBusy = check.isPending || end.isPending
  const email = account.data?.email

  return (
    <AuthScreen audience={AUDIENCES.waiting}>
      {(access.kind === ACCESS_KINDS.pending || access.kind === ACCESS_KINDS.revoked) && (
        <AuthCard
          title={PENDING_COPY[access.kind].title}
          lead={
            <>
              <Lead>{PENDING_COPY[access.kind].lead}</Lead>
              {email !== undefined && (
                <Lead>
                  {PENDING_COPY.signedInAs} <Address>{email}</Address>
                  {PENDING_COPY.signedInAsEnd}
                </Lead>
              )}
            </>
          }
        >
          <div className={styles.actions}>
            <Button tone="primary" disabled={isBusy} onClick={() => check.mutate()}>
              {check.isPending ? PENDING_COPY.checking : PENDING_COPY.checkAgain}
            </Button>
            <Button disabled={isBusy} onClick={() => end.mutate()}>
              {end.isPending ? COMMON_COPY.signingOut : COMMON_COPY.signOut}
            </Button>
          </div>
          {isFailed && <output className={styles.failed}>{PENDING_COPY.checkFailed}</output>}
        </AuthCard>
      )}
    </AuthScreen>
  )
}
