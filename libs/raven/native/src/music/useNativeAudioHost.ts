import { AUDIO_PLAYER_EVENTS, type AudioPlayerEvent, audioPlayer } from '@raven/audio'
import { AUDIO_PLATFORMS, type ApiClient, type Track } from '@raven/core'
import {
  AUDIO_STATES,
  playingTrackOf,
  runRemoteCommand,
  useAudioQueue,
  useTrackRate,
  useWindowedAudioHost,
} from '@raven/ui/headless'
import { useEffect, useEffectEvent, useMemo } from 'react'
import { Platform } from 'react-native'

import { audioItemOf } from '@/music/audioItem'
import { nativePlayerOf } from '@/music/nativePlayer'
import { watchAppHide } from '@/player/watchAppHide'
import type { MediaSources } from '@/servers/mediaAccess'
import type { AppServer } from '@/servers/serverList'

/** The player the music comes out of here: ExoPlayer on Android, AVPlayer on an iPhone or iPad. */
const PLATFORM = Platform.select({
  android: AUDIO_PLATFORMS.android,
  default: AUDIO_PLATFORMS.apple,
})

type UseNativeAudioHostProps = {
  api: ApiClient
  server: AppServer
  /**
   * Where a server's tracks play from, made once per server (`lastPerServer`) and asked for only
   * as a track is, so nothing watches the network before music plays.
   */
  sourcesFor: (server: AppServer) => Pick<MediaSources, 'source'>
}

/**
 * Music on a phone or a tablet: `@raven/audio` plays the shared queue store's track with the
 * next one ready behind it, as the desktop's engine does, so the seam plays in the background;
 * the lock screen's controls come back as remote commands and drive the store. A track this
 * device cannot decode is said and passed over. An audiobook plays at the prefs' speed, music
 * at 1.
 */
export const useNativeAudioHost = ({ api, server, sourcesFor }: UseNativeAudioHostProps): void => {
  const engine = useAudioQueue((store) => store.engine)
  const player = useMemo(
    () =>
      nativePlayerOf({
        audio: audioPlayer,
        itemOf: (track: Track) =>
          audioItemOf({ server: { api, sources: sourcesFor(server) }, track, platform: PLATFORM }),
      }),
    [api, server, sourcesFor],
  )
  // An audiobook's spot is saved as the app leaves the foreground, as the film player's is.
  const host = useWindowedAudioHost({ api, player, watchHide: watchAppHide })
  const track = useAudioQueue(playingTrackOf)
  const rate = useTrackRate({ api, track })

  // The player keeps the rate across its items, so it is told only when it changes.
  useEffect(() => {
    audioPlayer
      .setRate(rate)
      .catch(() => console.warn('Raven could not set how fast the track plays.'))
  }, [rate])

  const onEvent = useEffectEvent((event: AudioPlayerEvent) => {
    switch (event.type) {
      case AUDIO_PLAYER_EVENTS.state:
        engine.time({ position: event.position, duration: event.duration })
        if (event.isBuffering) return engine.state(AUDIO_STATES.loading)
        return engine.state(event.isPlaying ? AUDIO_STATES.playing : AUDIO_STATES.paused)
      case AUDIO_PLAYER_EVENTS.advanced:
        return host.advanced()
      case AUDIO_PLAYER_EVENTS.ended:
        return host.ended()
      case AUDIO_PLAYER_EVENTS.error:
        return engine.failed(event.message)
      case AUDIO_PLAYER_EVENTS.remote:
        return runRemoteCommand(event.command)
      // The car's browse requests are the browse tree's to answer, not the player's.
      case AUDIO_PLAYER_EVENTS.browse:
      case AUDIO_PLAYER_EVENTS.playFromBrowse:
        return
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  })

  useEffect(() => {
    const subscription = audioPlayer.onEvent({
      listener: (event) => onEvent(event),
      onUnknown: () => console.warn('Raven ignored a player event it does not understand.'),
    })
    return () => subscription.remove()
  }, [])
}
