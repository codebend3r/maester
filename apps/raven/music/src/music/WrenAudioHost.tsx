import { audioPlayer } from '@raven/audio'
import { isOnCellular, useNativeAudioHost } from '@raven/native'
import { useMemo } from 'react'

import { deviceDisk } from '@/downloads/downloader'
import { carBrowseFor } from '@/music/carBrowse'
import { coverHeadersOf } from '@/music/coverHeaders'
import { mediaSourcesFor } from '@/music/mediaSources'
import { trackPlanFor } from '@/music/trackPlan'
import type { WrenSession } from '@/useWren'

type WrenAudioHostProps = { session: Pick<WrenSession, 'server' | 'api'> }

/**
 * The one place Wren's music plays from, mounted above the routes so leaving a screen stops
 * nothing: `@raven/audio` plays the shared queue, in the background and on the lock screen. A
 * downloaded track plays from its file, and on a mobile network the rest stream at "Cellular
 * quality". CarPlay and Android Auto browse and play through it too.
 */
export function WrenAudioHost({ session: { server, api } }: WrenAudioHostProps) {
  const plan = useMemo(
    () => trackPlanFor({ serverId: server.id, isOnCellular, uriOf: deviceDisk.uriOf }),
    [server.id],
  )
  const car = useMemo(
    () =>
      carBrowseFor({
        api,
        serverId: server.id,
        uriOf: deviceDisk.uriOf,
        headersFor: (uri) => coverHeadersOf({ server, uri }),
        answer: (answer) => audioPlayer.answerBrowse(answer),
      }),
    [api, server],
  )
  useNativeAudioHost({ api, server, sourcesFor: mediaSourcesFor, plan, car })
  return null
}
