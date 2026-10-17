import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { type User, fetchMe } from '@/lib/api'
import styles from '@/pages/HomePage/HomePage.module.scss'

const HOME_STATE_KINDS = { loading: 'loading', signedIn: 'signed_in', failed: 'failed' } as const

type State =
  | { kind: typeof HOME_STATE_KINDS.loading }
  | { kind: typeof HOME_STATE_KINDS.signedIn; user: User }
  | { kind: typeof HOME_STATE_KINDS.failed }

/** Who is signed in, and a way out. Anyone without a session goes to `/login`. */
export const HomePage = () => {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: HOME_STATE_KINDS.loading })

  useEffect(() => {
    fetchMe().then(
      (user) =>
        user
          ? setState({ kind: HOME_STATE_KINDS.signedIn, user })
          : navigate('/login', { replace: true }),
      () => setState({ kind: HOME_STATE_KINDS.failed }),
    )
  }, [navigate])

  return (
    <Frame>
      {state.kind === HOME_STATE_KINDS.signedIn && (
        <>
          <div className={styles.who}>
            {state.user.thumb ? (
              <img className={styles.avatar} src={state.user.thumb} alt="" />
            ) : (
              <span className={styles.avatar} aria-hidden="true">
                {state.user.display_name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <h1 className={styles.title}>Signed in as {state.user.display_name}</h1>
          </div>
          <p className={styles.lede}>
            luwin and the rest of maester know you by this account. The sign-in lasts 30 days.
          </p>
          <Link className={styles.signOut} to="/logout">
            Sign out
          </Link>
        </>
      )}
      {state.kind === HOME_STATE_KINDS.loading && <p className={styles.lede}>One moment.</p>}
      {state.kind === HOME_STATE_KINDS.failed && (
        <p role="alert" className={styles.error}>
          rookery is not answering right now. Try again in a minute.
        </p>
      )}
    </Frame>
  )
}
