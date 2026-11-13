import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { net } from 'electron'
import type { AccountSignal } from '@/main/accounts/accountSignal'
import type { PageAccount } from '@/main/accounts/pageAccount'
import type { ServerEntry } from '@/main/desktopConfig'
import { fetchProbe, fetchRelayed } from '@/main/netFetches'
import { type AccountTickets, createAccountTickets } from '@/main/servers/accountTickets'
import { createMediaRelay, listenOnLoopback, type MediaRelay } from '@/main/servers/mediaRelay'
import { createOriginPicks, type OriginPicks } from '@/main/servers/originPicks'
import { createServerCalls, fetchThrough, type ServerCalls } from '@/main/servers/serverCalls'
import { createServerSources, type ServerSources } from '@/main/servers/serverSources'
import type { Timers } from '@/main/timers'

/** One relay and the server titles played through it. */
type RelayedSources = { relay: MediaRelay; sources: ServerSources }

export type ServerPlumbing = {
  calls: ServerCalls
  tickets: AccountTickets
  /** Where media is fetched from, for the relays and the downloads alike: one probe serves both. */
  picks: OriginPicks
  /** One load at a time: a new title retires the last one's secret. */
  video: RelayedSources
  /**
   * Music has a relay of its own, so a video and a track never retire each other's secrets, and
   * it keeps two loads: the track playing and the one mpv opens after it.
   */
  music: RelayedSources
}

type CreateServerPlumbingProps = {
  server: ServerEntry
  account: PageAccount
  /** The `Cookie` header with the page's unlock, so main's own calls carry the PIN it entered. */
  unlockOf: () => Promise<string | null>
  /** The page signed out, or into another account. */
  accessEnds: AccountSignal
  /** Another account signed in, or none. */
  accountSwitches: AccountSignal
  timers: Timers
  warn: (message: string) => void
}

/**
 * Main's reach to the server: its allowlisted calls with the page's Bearer and unlock, the account
 * tickets, the media origin picked and the two loopback relays. A sign out ends what is relayed;
 * a change of account mints its own tickets and probes the origins again.
 */
export const createServerPlumbing = ({
  server,
  account,
  unlockOf,
  accessEnds,
  accountSwitches,
  timers,
  warn,
}: CreateServerPlumbingProps): ServerPlumbing => {
  const calls = createServerCalls({
    server,
    fetch: fetchThrough((url, init) => net.fetch(url, init)),
    authorize: () => account.accessToken(),
    unlockOf,
    warn,
  })
  const tickets = createAccountTickets({
    calls,
    isSignedIn: () => account.accountId() !== null,
    now: Date.now,
  })
  const picks = createOriginPicks({
    server,
    calls,
    probe: fetchProbe,
    probeClock: () => performance.now(),
    now: Date.now,
    warn,
  })

  const relayedSources = (capacity: number): RelayedSources => {
    const relay = createMediaRelay({
      serverOrigin: server.origin,
      listen: listenOnLoopback({ createServer: (handler) => createServer(handler), warn }),
      fetchUpstream: fetchRelayed,
      tickets,
      newSecret: (bytes) => randomBytes(bytes).toString('base64url'),
      capacity,
      picks,
      timers,
      warn,
    })
    // A sign out: the title stops being relayed.
    accessEnds.listen(() => relay.accessEnded())
    return { relay, sources: createServerSources({ server, calls, tickets, relay, picks, warn }) }
  }

  // A ticket is the account's that minted it, so another account mints its own.
  accountSwitches.listen(() => tickets.forget())
  // Signed in, the origins are probed at once, so the first title does not wait on the probe.
  accountSwitches.listen(() => {
    if (account.accountId() === null) return
    picks.originOf().catch(() => undefined)
  })

  return { calls, tickets, picks, video: relayedSources(1), music: relayedSources(2) }
}
