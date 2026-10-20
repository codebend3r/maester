import { AUTH_STATES, type AuthConfigs } from '@/main/accounts/authConfigs'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import type { ServerEntry } from '@/main/desktopConfig'
import { loggable } from '@/main/servers/serverCalls'

/**
 * How long main waits for a server's accounts state before it goes by the server's pin instead:
 * under the same bound as a title's tracks.
 */
export const ACCOUNTS_TIMEOUT_MS = 3000

/**
 * Whether a server's accounts are ready, read within `ACCOUNTS_TIMEOUT_MS`. Playback and downloads
 * both ask it, so a title and its download agree on how they reach the server. Never rejects.
 */
export const accountsReadyWith =
  ({
    authConfigs,
    serverOf,
    warn,
  }: {
    authConfigs: Pick<AuthConfigs, 'stateOf'>
    serverOf: (serverId: string) => ServerEntry | null
    warn: (message: string) => void
  }) =>
  async (server: Pick<ServerEntry, 'id' | 'name'>): Promise<boolean> => {
    const bounded = await within({ task: authConfigs.stateOf(server.id), ms: ACCOUNTS_TIMEOUT_MS })
    if (bounded.outcome === BOUNDED_OUTCOMES.answered) {
      return bounded.result.kind === AUTH_STATES.ready
    }
    warn(`raven player could not tell whether ${loggable(server.name)} has accounts in time`)
    // A slow read (the sign-in moved sheet may be open) must not send a server pinned with
    // accounts down the cookie path it refuses; one never pinned keeps today's path (D1).
    return (serverOf(server.id)?.signIn ?? null) !== null
  }
