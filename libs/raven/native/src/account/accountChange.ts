import { useAudioQueue } from '@raven/ui/headless'
import type { AccountSession } from '@/account/supabaseAuth'

type SessionState = { session: AccountSession | null }

/** The slice of an account session store a watcher reads: who is signed in, and each change. */
type WatchedSession = {
  getState: () => SessionState
  subscribe: (listener: (state: SessionState, previous: SessionState) => void) => () => void
}

type AccountChange = {
  /** The account signed in now; null once signed out. */
  accountId: string | null
}

/** The slice of the app's query cache an account change empties. */
type AccountCache = { clear: () => void }

type ForgetOnAccountChangeProps = {
  session: WatchedSession
  /** The app's one query cache: the last account's answers. */
  cache: AccountCache
  /** What the app lets go of besides its cache and queue: the downloads another account owns. */
  alsoForget: (change: AccountChange) => void
}

/** Whose account a session holds: its user's id, or null signed out. */
export const accountIdOf = ({ session }: SessionState): string | null => session?.userId ?? null

/**
 * Empties the cache and the music queue whenever the signed-in account changes, signing out
 * included, so the next account never sees what the last one read (its favourites, its
 * playlists, its history) nor plays on under its token, then does the app's `alsoForget`. A
 * renewed token is the same account and changes nothing. zustand calls its listeners inside
 * `set`, before React renders again, so no screen reads the last account's answers. Hands back
 * the way to stop.
 */
export const forgetOnAccountChange = ({
  session,
  cache,
  alsoForget,
}: ForgetOnAccountChangeProps): (() => void) =>
  session.subscribe((state, previous) => {
    const accountId = accountIdOf(state)
    if (accountId === accountIdOf(previous)) return
    cache.clear()
    useAudioQueue.getState().clear()
    alsoForget({ accountId })
  })
