import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { ApiError, AUTH_REFUSALS } from '@raven/core'
import { Button } from '@raven/ui'
import { ACCESS_KINDS, useAccessState, useAccount } from '@/lib/accessState'
import { HOME_PATH, signInPath } from '@/lib/authRoutes'
import { signOut } from '@/lib/signOut'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'
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

type NoticeProps = {
  kind: keyof typeof COPY
  email: string | undefined
  isChecking: boolean
  isEnding: boolean
  isFailed: boolean
  onCheck: () => void
  onSignOut: () => void
}

const Notice = ({
  kind,
  email,
  isChecking,
  isEnding,
  isFailed,
  onCheck,
  onSignOut,
}: NoticeProps) => (
  <section className={signInStyles.form}>
    <Brand />
    <header className={signInStyles.welcome}>
      <h1 className={signInStyles.title}>{COPY[kind].title}</h1>
      <p className={signInStyles.lead}>{COPY[kind].lead}</p>
      {email !== undefined && (
        <p className={signInStyles.lead}>
          Signed in as <span className={styles.address}>{email}</span>.
        </p>
      )}
    </header>
    <div className={styles.actions}>
      <Button tone="primary" disabled={isChecking || isEnding} onClick={onCheck}>
        {isChecking ? 'Checking' : 'Check again'}
      </Button>
      <Button disabled={isChecking || isEnding} onClick={onSignOut}>
        {isEnding ? 'Signing out' : 'Sign out'}
      </Button>
    </div>
    {isFailed && <output className={styles.failed}>{CHECK_FAILED_COPY}</output>}
  </section>
)

/**
 * `/pending`: where the gate leaves an account that is not approved, waiting
 * or removed. It sits outside the gate and the browsing frame and reads no
 * library data. The screen keeps the visitor, or it would send a waiting
 * account straight back here; this page sends everyone else where they
 * belong, which keeps the gate and the page from sending a visitor back and
 * forth.
 *
 * The page asks for the access state and the account itself, and holds the
 * buttons' work, so all of it outlives the notice: a check that finds no
 * account yet empties the answer, and the screen shows the wait in its place.
 * A notice that asked for the account on mounting would ask again each time
 * it came back.
 */
export const PendingPage = () => {
  const queryClient = useQueryClient()
  const access = useAccessState()
  const account = useAccount()
  const check = useMutation({ mutationFn: () => account.refetch() })
  const end = useMutation({ mutationFn: () => signOut({ queryClient }) })
  const answer = check.data
  const isFailed = !!answer && answer.isError && !isAnswer(answer.error)

  const body = () => {
    switch (access.kind) {
      case ACCESS_KINDS.pending:
      case ACCESS_KINDS.revoked:
        return (
          <Notice
            kind={access.kind}
            email={account.data?.email}
            isChecking={check.isPending}
            isEnding={end.isPending}
            isFailed={isFailed}
            onCheck={() => check.mutate()}
            onSignOut={() => end.mutate()}
          />
        )
      case ACCESS_KINDS.signedOut:
        return <Navigate replace to={signInPath({ returnTo: HOME_PATH })} />
      case ACCESS_KINDS.approved:
      case ACCESS_KINDS.disabled:
        return <Navigate replace to={HOME_PATH} />
      case ACCESS_KINDS.loading:
      case ACCESS_KINDS.unavailable:
      case ACCESS_KINDS.failed:
        return null
      default: {
        const unreachable: never = access
        return unreachable
      }
    }
  }

  return <AuthScreen shouldKeepVisitor>{body()}</AuthScreen>
}
