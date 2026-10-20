import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import { ACCOUNT_ANSWERS, useAccountActions } from '@/renderer/desktop/accountApi'
import { Refusal } from '@/renderer/Account/Refusal'
import styles from '@/renderer/Account/SignInForm.module.scss'
import { ACCOUNT_PAGES, type AccountPage, MAX_SECRET } from '@/shared/protocol'

const focus = (element: HTMLElement | null) => {
  if (element !== null) element.focus()
}

/**
 * Email and password for one server's accounts. The password goes to main in the one sign in
 * request and is cleared whatever the answer is. A refusal is main's own sentence, said inline.
 */
export const SignInForm = ({
  serverId,
  signInHost,
  isRemembered,
  onSignedIn,
  onCancel,
}: {
  serverId: string
  /** The host the sign in goes to, as the account view names it; null when main did not say. */
  signInHost: string | null
  /** Whether main keeps a sign in across quitting. */
  isRemembered: boolean
  /** Called once main has signed the person in. */
  onSignedIn?: () => void
  /** Offers Cancel when given. */
  onCancel?: () => void
}) => {
  const { signIn, openAccountPage } = useAccountActions()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pageMessage, setPageMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const isSendingNow = useRef(false)
  const emailField = useRef<HTMLInputElement>(null)
  const passwordField = useRef<HTMLInputElement>(null)
  const messageId = useId()

  // The form opens because the person asked to sign in, so the cursor starts in it.
  useEffect(() => focus(emailField.current), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSendingNow.current) return
    isSendingNow.current = true
    setIsSending(true)
    setMessage(null)
    setPageMessage(null)
    const answer = await signIn({ serverId, email: email.trim(), password })
    isSendingNow.current = false
    setIsSending(false)
    setPassword('')
    if (answer.kind === ACCOUNT_ANSWERS.refused) {
      setMessage(answer.message)
      return focus(passwordField.current)
    }
    if (onSignedIn !== undefined) onSignedIn()
  }

  const openPage = async (page: AccountPage) => {
    setMessage(null)
    setPageMessage(null)
    const answer = await openAccountPage({ serverId, page })
    if (answer.kind === ACCOUNT_ANSWERS.refused) setPageMessage(answer.message)
  }

  const alert = message ?? pageMessage

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <label className={styles.field}>
        Email
        <input
          ref={emailField}
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          maxLength={MAX_SECRET}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        Password
        <input
          ref={passwordField}
          type="password"
          autoComplete="current-password"
          required
          maxLength={MAX_SECRET}
          value={password}
          aria-invalid={message !== null}
          aria-describedby={alert === null ? undefined : messageId}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {alert !== null && <Refusal id={messageId}>{alert}</Refusal>}
      <div className={styles.actions}>
        {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
        <Button type="submit" tone="primary" aria-disabled={isSending}>
          Sign in
        </Button>
        {onCancel !== undefined && <Button onClick={onCancel}>Cancel</Button>}
      </div>
      <div className={styles.links}>
        <Button tone="ghost" onClick={() => void openPage(ACCOUNT_PAGES.signUp)}>
          Create account
        </Button>
        <Button tone="ghost" onClick={() => void openPage(ACCOUNT_PAGES.forgot)}>
          Forgot password
        </Button>
      </div>
      {signInHost !== null && <p className={styles.note}>Signs in with {signInHost}.</p>}
      {!isRemembered && (
        <p className={styles.note}>
          raven player cannot keep your sign-in on this Mac, so you sign in again after quitting.
        </p>
      )}
    </form>
  )
}
