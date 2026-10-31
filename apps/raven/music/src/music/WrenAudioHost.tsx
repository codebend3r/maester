import { useNativeAudioHost } from '@raven/native'

import { mediaSourcesFor } from '@/music/mediaSources'
import type { WrenSession } from '@/useWren'

type WrenAudioHostProps = { session: Pick<WrenSession, 'server' | 'api'> }

/**
 * The one place Wren's music plays from, mounted above the routes so leaving a screen stops
 * nothing: `@raven/audio` plays the shared queue, in the background and on the lock screen. A
 * track this device cannot decode is said and passed over.
 */
export function WrenAudioHost({ session: { server, api } }: WrenAudioHostProps) {
  useNativeAudioHost({ api, server, sourcesFor: mediaSourcesFor })
  return null
}
