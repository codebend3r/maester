import { type AudioQuality, QUEUE_SOURCE_KINDS, type Track } from '@raven/core'
import { useAudioQueue, useIsAudiobook } from '@raven/ui/headless'
import {
  NOW_PLAYING_COPY,
  type SourceTitle,
  type ShownLyrics,
  shownLyricsOf,
  sourceIdOf,
  sourceTitleOf,
} from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'
import { type NowPlayingTrack, useNowPlaying } from '@/player/useNowPlaying'
import { useQuality } from '@/player/useQuality'
import { WREN_ROUTES, artistPath } from '@/routes'
import { useGoBack } from '@/shell/useGoBack'
import { useServerName } from '@/lib/serverName'
import { isOnDesktop } from '@/lib/desktopHost'

/** Whether the song's artists open a page. */
export const ARTIST_KINDS = { linked: 'linked', plain: 'plain' } as const

export type ArtistKind = (typeof ARTIST_KINDS)[keyof typeof ARTIST_KINDS]

/** The song's artists as a way in: the first one's page, or none for a song that credits none. */
export type PlayingArtist =
  | { kind: typeof ARTIST_KINDS.linked; href: string }
  | { kind: typeof ARTIST_KINDS.plain }

/** Everything both layouts draw the playing song from. */
export type Playing = NowPlayingTrack & {
  /** Where the queue plays from, as the header names it. */
  title: SourceTitle
  /** The song's lyrics, or that they are still being read. */
  lyrics: ShownLyrics
  isAudiobook: boolean
  /** "raven · This browser", or "raven · This Mac" in Wren for Mac. */
  output: string
  /** "Playing on this browser". */
  playingOn: string
  close: () => void
  /** The format and quality of what is playing; null until its source is made. */
  quality: AudioQuality | null
  /** The song's first artist's page, or that it credits none to open. */
  artist: PlayingArtist
}

type UsePlayingProps = { track: Track }

/** The playing song, its cover, artists and length, its lyrics, where it plays from and on, and the way out of the sheet. */
export const usePlaying = ({ track }: UsePlayingProps): Playing => {
  const nowPlaying = useNowPlaying({ track })
  const close = useGoBack({ fallback: WREN_ROUTES.home })
  const source = useAudioQueue((store) => store.queue.source)
  const isAudiobook = useIsAudiobook({ api, track })
  // A book has no words to look for.
  const lyrics = useQuery(queries.lyricsQuery(isAudiobook ? null : track.id))
  const playlist = useQuery(
    queries.playlistQuery(sourceIdOf({ source, kind: QUEUE_SOURCE_KINDS.playlist })),
  )
  const artist = useQuery(
    queries.artistQuery(sourceIdOf({ source, kind: QUEUE_SOURCE_KINDS.artist })),
  )
  const quality = useQuality({ track })
  const device = isOnDesktop() ? NOW_PLAYING_COPY.devices.mac : NOW_PLAYING_COPY.devices.browser
  const serverName = useServerName()
  const [firstArtist] = track.artists
  return {
    ...nowPlaying,
    title: sourceTitleOf({
      source,
      track,
      playlistName: playlist.data?.playlist.name ?? null,
      artistName: artist.data?.artist.name ?? null,
    }),
    lyrics: shownLyricsOf({ isAudiobook, lyrics }),
    isAudiobook,
    output: NOW_PLAYING_COPY.output({ server: serverName, device }),
    playingOn: NOW_PLAYING_COPY.playingOn(device),
    close,
    quality,
    artist:
      firstArtist === undefined
        ? { kind: ARTIST_KINDS.plain }
        : { kind: ARTIST_KINDS.linked, href: artistPath(firstArtist.id) },
  }
}
