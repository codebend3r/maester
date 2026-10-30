import {
  AUDIO_PLAYER_EVENTS,
  type AudioItem,
  type AudioPlayerEvent,
  audioPlayer,
} from '@raven/audio'
import { PLAYBACK_MODES, type Track, artistNames } from '@raven/core'
import { nativePlayerOf } from '@raven/native/headless'
import {
  AUDIO_STATES,
  playingTrackOf,
  runRemoteCommand,
  useAudioQueue,
  useTrackRate,
  useWindowedAudioHost,
} from '@raven/ui/headless'
import { type ComponentType, useEffect, useEffectEvent, useMemo } from 'react'
import { Platform } from 'react-native'

import { VideoAudioHost } from '@/music/VideoAudioHost'
import { mediaSourcesFor } from '@/player/mediaSources'
import { watchAppHide } from '@/player/progressSink'
import type { AppQueries } from '@/queries/useAppQueries'

/** What a music host reads of the active server. */
type MusicSession = Pick<AppQueries, 'server' | 'api'>

type ItemOfProps = { session: MusicSession; track: Track }

/** A track as the native player takes it: its ticketed address and what the lock screen shows. */
const itemOf = async ({ session, track }: ItemOfProps): Promise<AudioItem> => {
  const outcome = await mediaSourcesFor(session.server).source({
    media: { id: track.id },
    mode: PLAYBACK_MODES.direct,
    audio: null,
    burn: null,
  })
  if (!outcome.ok) throw new Error(outcome.message)
  return {
    id: track.id,
    uri: outcome.source.uri,
    headers: outcome.source.headers,
    title: track.title,
    artist: artistNames(track),
    album: track.album.title,
    artworkUri: session.api.albumCoverUrl({
      albumId: track.albumId,
      coverVersion: track.album.coverVersion,
    }),
    duration: track.duration,
  }
}

type NativeAudioHostProps = { session: MusicSession }

/**
 * Music on an iPhone or iPad: `@raven/audio` plays the shared queue store's track with the next
 * one ready behind it, as the desktop's engine does, so the seam plays in the background; the
 * lock screen's controls come back as remote commands and drive the store. An audiobook plays at
 * the prefs' speed, music at 1.
 */
const NativeAudioHost = ({ session: { server, api } }: NativeAudioHostProps) => {
  const engine = useAudioQueue((store) => store.engine)
  const player = useMemo(
    () =>
      nativePlayerOf({
        audio: audioPlayer,
        itemOf: (track) => itemOf({ session: { server, api }, track }),
      }),
    [server, api],
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

  return null
}

type MusicHostProps = { session: MusicSession }

/** The devices music plays differently on: a TV, or a touch screen. */
const HOST_KINDS = { tv: 'tv', touch: 'touch' } as const

type HostKind = (typeof HOST_KINDS)[keyof typeof HOST_KINDS]

/** The player each kind of device plays music through. */
const MUSIC_HOSTS = {
  [HOST_KINDS.tv]: VideoAudioHost,
  [HOST_KINDS.touch]: NativeAudioHost,
} as const satisfies Record<HostKind, ComponentType<MusicHostProps>>

/**
 * The one place music plays from, mounted above the routes so leaving a screen stops nothing:
 * `@raven/audio` on an iPhone or iPad, where the lock screen and the background matter, and the
 * video player out of sight on a TV.
 */
export const MusicHost = ({ session }: MusicHostProps) => {
  const Host = MUSIC_HOSTS[Platform.isTV ? HOST_KINDS.tv : HOST_KINDS.touch]
  return <Host session={session} />
}
