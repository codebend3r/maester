import type { PageSession } from '@raven/core'
import { accountIdOfToken } from '@/main/accounts/tokenAccount'

export type PageAccount = {
  /**
   * The page's session now, or null once it signed out. False, keeping what it had, when the
   * token does not name the account sent with it.
   */
  set: (session: PageSession | null) => boolean
  /** The Bearer for main's calls to the server; null while the page is signed out. */
  accessToken: () => string | null
  /** The account signed in, as the page's session names it; null while none is. */
  accountId: () => string | null
}

/**
 * The account the page signed in with, which main uses wherever it reaches the server for it:
 * media and account tickets, the relay, downloads and the plays it syncs. It lives in memory
 * alone; main never writes a token, so a relaunch waits for the page to send it again.
 */
export const createPageAccount = ({
  onSwitched,
  onEnded,
}: {
  /** Another account, or none, is signed in now. */
  onSwitched: () => void
  /** The page signed out, or into another account: whatever main holds on the last one's behalf ends. */
  onEnded: () => void
}): PageAccount => {
  let current: PageSession | null = null

  const set: PageAccount['set'] = (session) => {
    if (session !== null && accountIdOfToken(session.accessToken) !== session.userId) return false
    const before = current?.userId ?? null
    current = session
    const after = current?.userId ?? null
    if (before !== null && before !== after) onEnded()
    if (before !== after) onSwitched()
    return true
  }

  return {
    set,
    accessToken: () => current?.accessToken ?? null,
    accountId: () => current?.userId ?? null,
  }
}
