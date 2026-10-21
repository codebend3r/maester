import { create } from 'zustand'

import type { SessionChange } from '@/accounts/accountSessions'

type AccountState = {
  /** Whether each server has an account session kept, by server id, as last restored or written. */
  signedIn: Readonly<Record<string, boolean>>
  /**
   * Counts every session restored or written (a sign in, a refresh, a sign out), so what sends
   * the token outside `fetch` (the pictures) reads it again. It never holds the token itself.
   */
  version: number
}

/** Who is signed in to each server with accounts, in memory only; the sessions know the rest. */
export const useAccountState = create<AccountState>()(() => ({ signedIn: {}, version: 0 }))

/** Notes a server's session as it was restored or written. */
export const noteSession = ({ serverId, isSignedIn }: SessionChange): void =>
  useAccountState.setState(({ signedIn, version }) => ({
    signedIn: { ...signedIn, [serverId]: isSignedIn },
    version: version + 1,
  }))
