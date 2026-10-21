import { lastPerServer } from '@/queries/perServer'
import { mediaAccessFor } from '@/servers/mediaAccess'
import { probeFetchOf } from '@/servers/mediaProbe'
import { watchNetwork } from '@/servers/networkChanges'
import { apiFor, credentialsFor } from '@/servers/serverClient'
import { useAppPrefs } from '@/stores/appPrefs'

/**
 * Where the active server's videos play from, made once while it stays active, so its origins
 * are probed once and again only when the network changes; the last server's stops watching.
 * Each source reads Settings' away cap as it is asked for, so a change applies to the next one.
 */
export const mediaSourcesFor = lastPerServer({
  make: (server) =>
    mediaAccessFor({
      api: apiFor(server),
      server,
      now: Date.now,
      probe: probeFetchOf({ fetch, clock: Date.now }),
      readCredentials: () => credentialsFor(server),
      watchNetwork,
      awayMaxHeight: () => useAppPrefs.getState().awayMaxHeight,
    }),
  drop: (sources) => sources.close(),
})
