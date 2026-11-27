import type { DesktopReply } from '@raven/core'
import { type AccountSignal, createAccountSignal } from '@/main/accounts/accountSignal'
import type { ServerEntry } from '@/main/desktopConfig'
import { DONE, refused } from '@/main/replies'
import type { ServerDirectory } from '@/main/servers/serverDirectory'
import type { Timers } from '@shared/desktop'

/**
 * How long a switch waits for the page's sign-in: at launch the page may name the server it was
 * left on a moment before it hands main its session, and the account's list needs that session.
 */
export const SIGN_IN_WAIT_MS = 5000

export const ACTIVE_MESSAGES = {
  superseded: 'Another server was picked meanwhile.',
} as const

/** What a part of main reads of the server in use, as each step reaches out. */
export type ServerInUse = {
  /** The server every call, ticket, origin pick, relay and new download goes to now. */
  current: () => ServerEntry
  /** Whether `serverId` names the server in use: what is filed under any other waits for it. */
  isInUse: (serverId: string) => boolean
}

/** The server `current` reads, and the one test of whether an id names it. */
export const serverInUse = (current: () => ServerEntry): ServerInUse => ({
  current,
  isInUse: (serverId) => serverId === current().id,
})

/** The server in use and each change of it: what a part that lets go of the last server takes. */
export type SwitchingServer = ServerInUse & {
  /** Heard after each change of server, before `use` answers. */
  switches: Pick<AccountSignal, 'listen'>
}

export type ActiveServer = SwitchingServer & {
  /**
   * Uses the home server for null, else the account's server by `serverId` once the directory
   * confirms it. A refusal takes main home, where the page follows it, so no call goes to a
   * server the page has left; an ask a later one superseded changes nothing.
   */
  use: (serverId: string | null) => Promise<DesktopReply>
}

type CreateActiveServerProps = {
  /** The server the build plays from, filed under the config's own id. */
  home: ServerEntry
  directory: Pick<ServerDirectory, 'confirm'>
  isSignedIn: () => boolean
  /** The page's account changed, which may be the sign-in a switch is waiting for. */
  accountSwitches: Pick<AccountSignal, 'listen'>
  /** The account signed in left: signed out, or another signed in. */
  accessEnds: Pick<AccountSignal, 'listen'>
  timers: Timers
}

/**
 * The one server main reaches at a time. It starts at home each launch, and the page names the
 * one it uses (`useServer`) as it loads and whenever the viewer switches. Main never takes an
 * origin from the page: another server is the account's own, its origin read from the account's
 * list by the directory and its id confirmed on its health. A sign out or another account takes
 * it home and supersedes any switch still being confirmed, since the server was the last
 * account's and the next one's Bearer must not reach it unchecked; the page goes home with it.
 */
export const createActiveServer = ({
  home,
  directory,
  isSignedIn,
  accountSwitches,
  accessEnds,
  timers,
}: CreateActiveServerProps): ActiveServer => {
  let current = home
  // Each ask's turn: one that settles after a later ask was made changes nothing.
  let asked = 0
  const switches = createAccountSignal()

  const moveTo = (server: ServerEntry): void => {
    if (server.id === current.id && server.origin === current.origin) return
    current = server
    switches.notify()
  }

  /** Settles once the page is signed in, or once it has had `SIGN_IN_WAIT_MS` to be. */
  const signedIn = (): Promise<void> => {
    if (isSignedIn()) return Promise.resolve()
    const waited = Promise.withResolvers<void>()
    const timer = timers.set({ run: () => waited.resolve(), ms: SIGN_IN_WAIT_MS })
    const stop = accountSwitches.listen(() => {
      if (isSignedIn()) waited.resolve()
    })
    return waited.promise.finally(() => {
      timers.clear(timer)
      stop()
    })
  }

  accessEnds.listen(() => {
    asked += 1
    moveTo(home)
  })

  const use: ActiveServer['use'] = async (serverId) => {
    asked += 1
    const turn = asked
    if (serverId === null) {
      moveTo(home)
      return DONE
    }
    if (serverId === current.id) return DONE
    await signedIn()
    const confirmed = await directory.confirm(serverId)
    if (turn !== asked) return refused(ACTIVE_MESSAGES.superseded)
    if (!confirmed.ok) {
      moveTo(home)
      return refused(confirmed.message)
    }
    moveTo(confirmed.server)
    return DONE
  }

  return { ...serverInUse(() => current), use, switches }
}
