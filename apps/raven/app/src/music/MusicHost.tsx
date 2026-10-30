import type { AudioItem } from '@raven/audio'
import { PLAYBACK_MODES, type Track, artistNames } from '@raven/core'
import { useNativeAudioHost } from '@raven/native'
import { type ComponentType, useCallback } from 'react'
import { Platform } from 'react-native'

import { VideoAudioHost } from '@/music/VideoAudioHost'
import { mediaSourcesFor } from '@/player/mediaSources'
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

/** Music on an iPhone or iPad, through `@raven/native`'s host over `@raven/audio`. */
const NativeAudioHost = ({ session: { server, api } }: NativeAudioHostProps) => {
  const play = useCallback(
    (track: Track) => itemOf({ session: { server, api }, track }),
    [server, api],
  )
  useNativeAudioHost({ api, itemOf: play })
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
