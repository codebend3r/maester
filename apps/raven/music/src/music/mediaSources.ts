import { MAX_HEIGHTS } from '@raven/core'
import { accessTokenNow, apiFor, cookieJar, watchNetwork } from '@raven/native'
import { lastPerServer, mediaAccessFor, probeFetchOf } from '@raven/native/headless'

import { useWrenAccount } from '@/session'

/**
 * Where the active server's tracks play from, made once while it stays active, so its origins
 * are probed once and again only when the network changes; the last server's stops watching.
 * Music plays the file itself, so the away cap, which only a video's transcode reads, is moot.
 */
export const mediaSourcesFor = lastPerServer({
  make: (server) =>
    mediaAccessFor({
      api: apiFor({ server, session: useWrenAccount }),
      server,
      now: Date.now,
      probe: probeFetchOf({ fetch, clock: Date.now }),
      readCookies: () => cookieJar.read(server.id),
      readAccessToken: () => accessTokenNow({ session: useWrenAccount }),
      watchNetwork,
      awayMaxHeight: () => MAX_HEIGHTS.fullHd,
    }),
  drop: (sources) => sources.close(),
})
