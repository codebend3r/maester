import { isOnCellular, useNativeAudioHost } from '@raven/native'
import { useMemo } from 'react'

import { deviceDisk } from '@/downloads/downloader'
import { mediaSourcesFor } from '@/music/mediaSources'
import { trackPlanFor } from '@/music/trackPlan'
import type { WrenSession } from '@/useWren'

type WrenAudioHostProps = { session: Pick<WrenSession, 'server' | 'api'> }

/**
 * The one place Wren's music plays from, mounted above the routes so leaving a screen stops
 * nothing: `@raven/audio` plays the shared queue, in the background and on the lock screen. A
 * downloaded track plays from its file, and on a mobile network the rest stream at "Cellular
 * quality".
 */
export function WrenAudioHost({ session: { server, api } }: WrenAudioHostProps) {
  const plan = useMemo(
    () => trackPlanFor({ serverId: server.id, isOnCellular, uriOf: deviceDisk.uriOf }),
    [server.id],
  )
  useNativeAudioHost({ api, server, sourcesFor: mediaSourcesFor, plan })
  return null
}
