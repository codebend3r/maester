import { AUDIO_PLAYER_EVENTS, type AudioPlayerEvent, audioPlayer } from '@raven/audio'
import type { ApiClient } from '@raven/core'
import {
  AUDIO_STATES,
  playingTrackOf,
  runRemoteCommand,
  useAudioQueue,
  useTrackRate,
  useWindowedAudioHost,
} from '@raven/ui/headless'
import { useEffect, useEffectEvent, useMemo } from 'react'

import { nativePlayerOf } from '@/music/nativePlayer'
import { watchAppHide } from '@/player/watchAppHide'

type UseNativeAudioHostProps = {
  api: ApiClient
  /** The track as the player takes it, the same function while the server stays: a new one makes a new player. */
  itemOf: Parameters<typeof nativePlayerOf>[0]['itemOf']
}

/**
 * Music on a phone or a tablet: `@raven/audio` plays the shared queue store's track with the
 * next one ready behind it, as the desktop's engine does, so the seam plays in the background;
 * the lock screen's controls come back as remote commands and drive the store. An audiobook
 * plays at the prefs' speed, music at 1.
 */
export const useNativeAudioHost = ({ api, itemOf }: UseNativeAudioHostProps): void => {
  const engine = useAudioQueue((store) => store.engine)
  const player = useMemo(() => nativePlayerOf({ audio: audioPlayer, itemOf }), [itemOf])
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
