import { lastPerServer } from '@/queries/perServer'
import { mediaAccessFor } from '@/servers/mediaAccess'
import { probeFetchOf } from '@/servers/mediaProbe'
import { watchNetwork } from '@/servers/networkChanges'
import { apiFor, cookieJar } from '@/servers/serverClient'

/**
 * Where the active server's videos play from, made once while it stays active, so its origins
 * are probed once and again only when the network changes; the last server's stops watching.
 */
export const mediaSourcesFor = lastPerServer({
  make: (server) =>
    mediaAccessFor({
      api: apiFor(server),
      server,
      now: Date.now,
      probe: probeFetchOf({ fetch, clock: Date.now }),
      readCookies: () => cookieJar.read(server.id),
      watchNetwork,
    }),
  drop: (sources) => sources.close(),
})
