import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '@raven/ui'
import { Logo } from '@/components/Logo/Logo'
import { PosterWall } from '@/pages/SignInPage/PosterWall'
import styles from '@/pages/SignInPage/SignInPage.module.scss'

/** What the form hands over: where to sign in, as whom, and whether to stay signed in here. */
export type SignInDetails = {
  server: string
  name: string
  password: string
  keepSignedIn: boolean
}

/** Signs in, resolving once the viewer is in, rejecting with an Error that says why not. */
export type SignIn = (details: SignInDetails) => Promise<void>

/** raven has no accounts yet, so for now signing in says so. */
export const signInUnavailable: SignIn = () =>
  Promise.reject(new Error('This server has no accounts to sign in to yet.'))

/** A server's address as typed, or none while it does not parse as one with a host. */
const addressOf = (server: string): URL | undefined => {
  try {
    const address = new URL(server.trim())
    return address.hostname === '' ? undefined : address
  } catch {
    return undefined
  }
}

/**
 * `/sign-in`, the whole screen: a tilted wall of posters with raven's
 * promise over it, put away on a phone, beside the form. The server comes
 * filled in with the one this page came from, its dot lit since it plainly
 * answers, and the line above the form names its host. Then the name, the
 * password with Show to read it back, and whether to stay signed in on this
 * device. `onSignIn` does the signing in: while it runs, Sign in reads
 * Signing in…; once it resolves, the viewer goes home; if it rejects, its
 * message shows under the password, which is marked as the field to fix.
 */
export const SignInPage = ({ onSignIn }: { onSignIn: SignIn }) => {
  const ids = {
    server: useId(),
    serverStatus: useId(),
    name: useId(),
    password: useId(),
    error: useId(),
  }
  const navigate = useNavigate()
  const [server, setServer] = useState(window.location.origin)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [isShown, setShown] = useState(false)
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const signIn = useMutation({
    mutationFn: onSignIn,
    onSuccess: () => navigate('/'),
  })
  const address = addressOf(server)
  const isHome = address?.origin === window.location.origin
  const isFailed = signIn.isError

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (signIn.isPending) return
    signIn.mutate({ server: server.trim(), name, password, keepSignedIn })
  }

  return (
    <div className={styles.page}>
      <PosterWall />
      <main className={styles.side}>
        <form className={styles.form} onSubmit={submit}>
          <span className={styles.brand}>
            <Logo />
          </span>
          <header className={styles.welcome}>
            <h1 className={styles.title}>Welcome back</h1>
            <p className={styles.lead}>
              Sign in to watch on {address?.hostname ?? window.location.hostname}
            </p>
          </header>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor={ids.server} className={styles.label}>
                Server
              </label>
              <div className={`${styles.box} ${styles.server}`}>
                <span className={isHome ? `${styles.dot} ${styles.answering}` : styles.dot} />
                <input
                  id={ids.server}
                  className={styles.boxed}
                  type="url"
                  name="server"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  required
                  aria-describedby={ids.serverStatus}
                  value={server}
                  onChange={(event) => setServer(event.target.value)}
                />
              </div>
              <span id={ids.serverStatus} className="visually-hidden">
                {isHome ? 'This page came from this server, so it answers.' : 'Not checked.'}
              </span>
            </div>
            <div className={styles.field}>
              <label htmlFor={ids.name} className={styles.label}>
                Name
              </label>
              <input
                id={ids.name}
                className={styles.input}
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={ids.password} className={styles.label}>
                Password
              </label>
              <div
                className={
                  isFailed
                    ? `${styles.box} ${styles.secret} ${styles.invalid}`
                    : `${styles.box} ${styles.secret}`
                }
              >
                <input
                  id={ids.password}
                  className={styles.boxed}
                  type={isShown ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  aria-invalid={isFailed}
                  aria-describedby={isFailed ? ids.error : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button
                  tone="ghost"
                  className={styles.reveal}
                  aria-controls={ids.password}
                  onClick={() => setShown((now) => !now)}
                >
                  {isShown ? 'Hide' : 'Show'}
                  <span className="visually-hidden"> password</span>
                </Button>
              </div>
              {isFailed && (
                <p id={ids.error} role="alert" className={styles.alert}>
                  <span className={styles.alertIcon}>
                    <Icon name="alert" size={18} />
                  </span>
                  <span className={styles.alertText}>{signIn.error.message}</span>
                </p>
              )}
            </div>
            <label className={styles.keep}>
              <input
                type="checkbox"
                name="remember"
                className={styles.check}
                checked={keepSignedIn}
                onChange={(event) => setKeepSignedIn(event.target.checked)}
              />
              Keep me signed in on this device
            </label>
          </div>
          <Button type="submit" tone="primary" className={styles.submit}>
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </main>
    </div>
  )
}
