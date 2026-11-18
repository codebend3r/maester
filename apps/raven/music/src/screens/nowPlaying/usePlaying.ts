import { type Lyrics, NO_LYRICS, QUEUE_SOURCE_KINDS, type Track } from '@raven/core'
import { useAudioQueue, useIsAudiobook } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Platform } from 'react-native'

import { type NowPlayingTrack, useNowPlaying } from '@/player/useNowPlaying'
import { NOW_PLAYING_COPY } from '@/screens/copy'
import { type SourceTitle, deviceOf, sourceTitleOf } from '@/screens/nowPlaying/nowPlayingModel'
import { qualityLineOf } from '@/screens/nowPlaying/quality'
import { WREN_PAGES, pageHref } from '@/routes'
import { usePlayedStreams } from '@/stores/playedStreams'
import { useFormFactor } from '@/theme/wrenTheme'
import type { WrenSession } from '@/useWren'

/** Everything both layouts draw the playing song from. */
export type Playing = NowPlayingTrack & {
  session: WrenSession
  /** Where the queue plays from, as the header names it. */
  title: SourceTitle
  /** The song's lyrics, null while they are read. */
  lyrics: Lyrics | null
  isAudiobook: boolean
  /** "raven · This iPhone". */
  output: string
  /** "Playing on this iPad". */
  playingOn: string
  close: () => void
  /** The format and quality of what is playing, "FLAC · 16-bit / 44.1 kHz · 912 kbps"; null until its source is made. */
  quality: string | null
  /** Opens the song's first artist's page, or nothing when it credits none. */
  openArtist: (() => void) | null
}

type ShownLyricsOfProps = {
  isAudiobook: boolean
  lyrics: { data: Lyrics | undefined; isError: boolean }
}

/** The lyrics shown: none for a book, and none, quietly, for a failed read. */
const shownLyricsOf = ({ isAudiobook, lyrics }: ShownLyricsOfProps): Lyrics | null => {
  if (isAudiobook) return NO_LYRICS
  if (lyrics.data !== undefined) return lyrics.data
  return lyrics.isError ? NO_LYRICS : null
}

type UsePlayingProps = { session: WrenSession; track: Track }

/** The playing song, its cover, artists and length, its lyrics, where it plays from and on, and the ways out of the sheet. */
export const usePlaying = ({ session, track }: UsePlayingProps): Playing => {
  const nowPlaying = useNowPlaying({ session, track })
  const router = useRouter()
  const formFactor = useFormFactor()
  const source = useAudioQueue((store) => store.queue.source)
  const isAudiobook = useIsAudiobook({ api: session.api, track })
  // A book has no words to look for.
  const lyrics = useQuery(session.queries.lyricsQuery(isAudiobook ? null : track.id))
  const sourceKind = source?.kind ?? null
  const sourceId = source?.id ?? null
  const playlist = useQuery(
    session.queries.playlistQuery(
      sourceKind === QUEUE_SOURCE_KINDS.playlist && typeof sourceId === 'number' ? sourceId : null,
    ),
  )
  const artist = useQuery(
    session.queries.artistQuery(
      sourceKind === QUEUE_SOURCE_KINDS.artist && typeof sourceId === 'number' ? sourceId : null,
    ),
  )
  const stream = usePlayedStreams((store) => store.streams[track.id])
  const device = deviceOf({ os: Platform.OS, formFactor })
  const [firstArtist] = track.artists
  const close = () => router.back()
  return {
    ...nowPlaying,
    session,
    title: sourceTitleOf({
      source,
      track,
      playlistName: playlist.data?.playlist.name ?? null,
      artistName: artist.data?.artist.name ?? null,
    }),
    lyrics: shownLyricsOf({ isAudiobook, lyrics }),
    isAudiobook,
    output: NOW_PLAYING_COPY.output({ server: session.server.name, device }),
    playingOn: NOW_PLAYING_COPY.playingOn(device),
    close,
    quality: stream === undefined ? null : qualityLineOf({ track, stream }),
    openArtist:
      firstArtist === undefined
        ? null
        : () => {
            close()
            router.push(pageHref({ page: WREN_PAGES.artist, id: firstArtist.id }))
          },
  }
}
