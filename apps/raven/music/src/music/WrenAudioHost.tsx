import { AUDIO_PLATFORMS, type Track } from '@raven/core'
import { useNativeAudioHost } from '@raven/native'
import { useCallback } from 'react'
import { Platform } from 'react-native'

import { itemOf } from '@/music/itemOf'
import { mediaSourcesFor } from '@/music/mediaSources'
import type { WrenSession } from '@/useWren'

/** The player Wren's music comes out of here: ExoPlayer on Android, AVPlayer on an iPhone or iPad. */
const PLATFORM = Platform.select({
  android: AUDIO_PLATFORMS.android,
  default: AUDIO_PLATFORMS.apple,
})

type WrenAudioHostProps = { session: Pick<WrenSession, 'server' | 'api'> }

/**
 * The one place Wren's music plays from, mounted above the routes so leaving a screen stops
 * nothing: `@raven/audio` plays the shared queue, in the background and on the lock screen. A
 * track this device cannot decode is said and passed over.
 */
export function WrenAudioHost({ session: { server, api } }: WrenAudioHostProps) {
  const play = useCallback(
    (track: Track) =>
      itemOf({ server: { api, sources: mediaSourcesFor(server) }, track, platform: PLATFORM }),
    [server, api],
  )
  useNativeAudioHost({ api, itemOf: play })
  return null
}
