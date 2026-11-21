import {
  type AudioBitrate,
  type Lyrics,
  QUEUE_SOURCE_KINDS,
  TRACK_STREAM_KINDS,
  type Track,
  type TrackStream,
} from '@raven/core'
import { useAudioQueue, useIsAudiobook, useTrackBitrate } from '@raven/ui/headless'
import {
  NOW_PLAYING_COPY,
  STATUS_COPY,
  type SourceTitle,
  qualityLineOf,
  shownLyricsOf,
  sourceIdOf,
  sourceTitleOf,
} from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'
import { type NowPlayingTrack, useNowPlaying } from '@/player/useNowPlaying'
import { WREN_ROUTES, artistPath } from '@/routes'
import { useGoBack } from '@/shell/useGoBack'

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
  /** The song's lyrics, null while they are read. */
  lyrics: Lyrics | null
  isAudiobook: boolean
  /** "raven · This browser". */
  output: string
  /** "Playing on this browser". */
  playingOn: string
  close: () => void
  /** The format and quality of what is playing, "FLAC · 16-bit / 44.1 kHz · 912 kbps"; null until its source is made. */
  quality: string | null
  /** The song's first artist's page, or that it credits none to open. */
  artist: PlayingArtist
}

/*
 * The stream the host's own decision makes: the transcode at `kbps`, or the file when it names
 * none. A browser plays nothing from a download, so the apps' third stream is never made here.
 */
const trackStreamOf = (kbps: AudioBitrate | null): TrackStream =>
  kbps === null ? { kind: TRACK_STREAM_KINDS.file } : { kind: TRACK_STREAM_KINDS.transcode, kbps }

type UseQualityProps = { track: Track }

/*
 * The format and quality line, from the decision `@raven/ui`'s `AudioHost` plays by: nothing
 * while the libraries that tell a book from music are read, which the host waits out before it
 * sets a source, then the file, or the transcode at the bitrate the prefs pick.
 */
const useQuality = ({ track }: UseQualityProps): string | null => {
  const libraries = useQuery(queries.librariesQuery)
  const kbps = useTrackBitrate({ api, track })
  return libraries.isPending ? null : qualityLineOf({ track, stream: trackStreamOf(kbps) })
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
  const device = NOW_PLAYING_COPY.devices.browser
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
    output: NOW_PLAYING_COPY.output({ server: STATUS_COPY.raven, device }),
    playingOn: NOW_PLAYING_COPY.playingOn(device),
    close,
    quality,
    artist:
      firstArtist === undefined
        ? { kind: ARTIST_KINDS.plain }
        : { kind: ARTIST_KINDS.linked, href: artistPath(firstArtist.id) },
  }
}
