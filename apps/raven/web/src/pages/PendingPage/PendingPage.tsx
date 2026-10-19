import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, AUTH_REFUSALS } from '@raven/core'
import { Button } from '@raven/ui'
import { Address, AuthCard, Lead } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { ACCESS_KINDS, useAccessState, useAccount } from '@/lib/accessState'
import { signOut } from '@/lib/session'
import styles from '@/pages/PendingPage/PendingPage.module.scss'

const COPY = {
  [ACCESS_KINDS.pending]: {
    title: 'Waiting for approval',
    lead: 'The owner of this raven approves each new account by hand. You can start watching once they have.',
  },
  [ACCESS_KINDS.revoked]: {
    title: 'Your access was removed',
    lead: "The owner of this raven removed this account's access. Ask them if you think that is a mistake.",
  },
} as const

const CHECK_FAILED_COPY = 'Could not check. Try again.'

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
  const queryClient = useQueryClient()
  const access = useAccessState()
  const account = useAccount()
  const check = useMutation({ mutationFn: () => account.refetch() })
  const end = useMutation({ mutationFn: () => signOut({ queryClient }) })
  const answer = check.data
  const isFailed = !!answer && answer.isError && !isAnswer(answer.error)
  const isBusy = check.isPending || end.isPending
  const email = account.data?.email

  return (
    <AuthScreen audience={AUDIENCES.waiting}>
      {(access.kind === ACCESS_KINDS.pending || access.kind === ACCESS_KINDS.revoked) && (
        <AuthCard
          title={COPY[access.kind].title}
          lead={
            <>
              <Lead>{COPY[access.kind].lead}</Lead>
              {email !== undefined && (
                <Lead>
                  Signed in as <Address>{email}</Address>.
                </Lead>
              )}
            </>
          }
        >
          <div className={styles.actions}>
            <Button tone="primary" disabled={isBusy} onClick={() => check.mutate()}>
              {check.isPending ? 'Checking' : 'Check again'}
            </Button>
            <Button disabled={isBusy} onClick={() => end.mutate()}>
              {end.isPending ? 'Signing out' : 'Sign out'}
            </Button>
          </div>
          {isFailed && <output className={styles.failed}>{CHECK_FAILED_COPY}</output>}
        </AuthCard>
      )}
    </AuthScreen>
  )
}
