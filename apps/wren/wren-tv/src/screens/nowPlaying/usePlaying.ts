import { type ArtistCredit, type AudioQuality, QUEUE_SOURCE_KINDS, type Track } from '@raven/core'
import { usePlayedQuality } from '@raven/native/headless'
import { useAudioQueue, useIsAudiobook } from '@raven/ui/headless'
import {
  type ShownLyrics,
  type SourceTitle,
  shownLyricsOf,
  sourceIdOf,
  sourceTitleOf,
} from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { type NowPlayingTrack, useNowPlaying, type WrenSession } from '@raven/wren-native'

/** Everything Now Playing draws the playing song from. */
export type Playing = NowPlayingTrack & {
  session: WrenSession
  /** Where the queue plays from, as the head names it. */
  title: SourceTitle
  /** The song's lyrics, or that they are still being read. */
  lyrics: ShownLyrics
  isAudiobook: boolean
  /** The format and quality of what is playing; null until its source is made. */
  quality: AudioQuality | null
  /** The song's first artist, whose page its artists open; null when it credits none. */
  firstArtist: ArtistCredit | null
}

type UsePlayingProps = { session: WrenSession; track: Track }

/** The playing song, its cover, artists and length, its lyrics, where it plays from and what it plays as. */
export const usePlaying = ({ session, track }: UsePlayingProps): Playing => {
  const nowPlaying = useNowPlaying({ session, track })
  const source = useAudioQueue((store) => store.queue.source)
  const isAudiobook = useIsAudiobook({ api: session.api, track })
  // A book has no words to look for.
  const lyrics = useQuery(session.queries.lyricsQuery(isAudiobook ? null : track.id))
  const playlist = useQuery(
    session.queries.playlistQuery(sourceIdOf({ source, kind: QUEUE_SOURCE_KINDS.playlist })),
  )
  const artist = useQuery(
    session.queries.artistQuery(sourceIdOf({ source, kind: QUEUE_SOURCE_KINDS.artist })),
  )
  const quality = usePlayedQuality({ track })
  const [firstArtist] = track.artists
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
    quality,
    firstArtist: firstArtist ?? null,
  }
}
