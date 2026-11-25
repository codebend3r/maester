import { type FormEvent, useId, useState } from 'react'
import { BUTTON_TONES, Button } from '@/components/Button/Button'
import { SIGN_IN_COPY, SIGN_IN_FAILURE_COPY } from '@/components/SignIn/copy'
import styles from '@/components/SignIn/SignIn.module.scss'
import { SPARROW_SIZES, SparrowMark } from '@/components/SparrowMark/SparrowMark'
import { SIGN_IN_FAILURES, type SignInFailure, signIn } from '@/lib/signIn'

const failureText = (failure: SignInFailure): string =>
  failure.kind === SIGN_IN_FAILURES.refused ? failure.message : SIGN_IN_FAILURE_COPY[failure.kind]

/** The raven account's email and password; once Supabase lets them in, the page asks sparrow again. */
export const SignIn = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [failure, setFailure] = useState<SignInFailure | null>(null)
  const headingId = useId()

  const attempt = async (): Promise<void> => {
    setIsBusy(true)
    setFailure(null)
    try {
      const failed = await signIn({ email: email.trim(), password })
      setFailure(failed)
      if (failed === null) setPassword('')
    } finally {
      setIsBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (email.trim() === '' || password === '') {
      setFailure({ kind: SIGN_IN_FAILURES.missing })
      return
    }
    // `signIn` answers every failure as its result and never rejects.
    attempt().catch(() => undefined)
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby={headingId}>
        <span className={styles.badge}>
          <SparrowMark size={SPARROW_SIZES.md} />
        </span>
        <h1 id={headingId} className={styles.heading}>
          {SIGN_IN_COPY.heading}
        </h1>
        <p className={styles.lede}>{SIGN_IN_COPY.lede}</p>
        <form className={styles.form} noValidate onSubmit={submit}>
          <label className={styles.field}>
            <span>{SIGN_IN_COPY.email}</span>
            <input
              className={styles.input}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{SIGN_IN_COPY.password}</span>
            <input
              className={styles.input}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {failure !== null && (
            <p className={styles.alert} role="alert">
              {failureText(failure)}
            </p>
          )}
          <Button type="submit" tone={BUTTON_TONES.primary} disabled={isBusy}>
            {isBusy ? SIGN_IN_COPY.signingIn : SIGN_IN_COPY.signIn}
          </Button>
        </form>
      </section>
    </main>
  )
}
