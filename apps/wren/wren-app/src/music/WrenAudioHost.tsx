import { audioPlayer } from '@raven/audio'
import { isOnCellular, useNativeAudioHost } from '@raven/native'
import { useMemo } from 'react'

import { deviceDisk } from '@/downloads/downloader'
import { carBrowseFor } from '@/music/carBrowse'
import { coverHeadersOf } from '@/music/coverHeaders'
import {
  deviceSpotFor,
  mediaSourcesFor,
  useKeepSongProgress,
  type WrenSession,
} from '@raven/wren-native'
import { trackPlanFor } from '@/music/trackPlan'

type WrenAudioHostProps = { session: Pick<WrenSession, 'server' | 'api'> }

/**
 * The one place Wren's music plays from, mounted above the routes so leaving a screen stops
 * nothing: `@raven/audio` plays the shared queue, in the background and on the lock screen. A
 * downloaded track plays from its file, and on a mobile network the rest stream at "Cellular
 * quality". CarPlay and Android Auto browse and play through it too. Each song's progress is
 * kept on this device, and a song left partway starts where it was left.
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
  const deviceSpotOf = useMemo(() => deviceSpotFor({ serverId: server.id }), [server.id])
  useNativeAudioHost({ api, server, sourcesFor: mediaSourcesFor, plan, car, deviceSpotOf })
  useKeepSongProgress({ serverId: server.id })
  return null
}
