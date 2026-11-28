import {
  NO_LYRICS,
  type Track,
  artistNames,
  chapterAt,
  nextChapterStart,
  previousChapterStart,
  queueRowsOf,
} from '@raven/core'
import {
  AUDIO_STATES,
  playingTrackOf,
  useAudioQueue,
  useAudiobookChapters,
  usePlayerPrefs,
  useTrackFavourite,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { FavouriteButton, NowPlayingLayout } from '@/layouts'
import { MUSIC_COPY } from '@/layouts/copy'
import type { BookControls } from '@/layouts/musicKit'
import { chapterRowsOf, nowPlayingAsideOf, queueFactsOf } from '@/layouts/musicRows'
import { trackCoverOf } from '@/music/musicCards'
import { usePlayingQuality } from '@/music/usePlayingQuality'
import { usePlaylistAdd } from '@/music/usePlaylistAdd'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'

type TrackHeartProps = {
  session: Pick<AppQueries, 'api' | 'queries'>
  track: Track
  /** Told when the server refuses the mark, so the page can say so. */
  onFailure: () => void
}

/** The playing track's heart: filled for a favourite, and pressing it marks or unmarks one. */
const TrackHeart = ({ session: { api, queries }, track, onFailure }: TrackHeartProps) => {
  const { isLiked, onToggle } = useTrackFavourite({ api, queries, track, onFailure })
  return <FavouriteButton isFavourite={isLiked} onToggle={onToggle} />
}

type NowPlayingPageProps = { session: AppQueries }

const NowPlayingPage = ({ session }: NowPlayingPageProps) => {
  const { server, api, queries } = session
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const track = useAudioQueue(playingTrackOf)
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  const previous = useAudioQueue((store) => store.previous)
  const jump = useAudioQueue((store) => store.jump)
  const remove = useAudioQueue((store) => store.remove)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const clear = useAudioQueue((store) => store.clear)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  const setSpeed = usePlayerPrefs((prefs) => prefs.setAudiobookSpeed)
  const { isAudiobook, chapters } = useAudiobookChapters({ api, track })
  // A book has chapters in place of lyrics, so its words are never looked for.
  const lyrics = useQuery(queries.lyricsQuery(track === null || isAudiobook ? null : track.id))
  const { playlists, addToPlaylist, note } = usePlaylistAdd({ session })
  const [heartNote, setHeartNote] = useState<string | null>(null)
  const quality = usePlayingQuality({ track })
  const rows = queueRowsOf({ queue, tracks })
  const cover =
    track === null || pictures === null
      ? null
      : trackCoverOf({ api, headersFor: pictures.headersFor, track })
  const playing =
    track === null
      ? null
      : {
          played: track,
          title: track.title,
          artists: artistNames(track),
          album: track.album.title,
          cover,
        }
  const nextStart = nextChapterStart({ chapters, at: position })
  const onNextChapter = nextStart === null ? null : () => seekTo(nextStart)
  const book: BookControls | null = isAudiobook
    ? {
        chapters: chapterRowsOf({ chapters, current: chapterAt({ chapters, at: position }) }),
        speed,
        onChapter: seekTo,
        onPreviousChapter: () => seekTo(previousChapterStart({ chapters, at: position })),
        onNextChapter,
        onSpeed: setSpeed,
      }
    : null
  // A failed read is said as no lyrics, quietly.
  const shownLyrics = lyrics.data ?? (lyrics.isError ? NO_LYRICS : null)
  return (
    <NowPlayingLayout
      aside={nowPlayingAsideOf({ book, lyrics: shownLyrics, at: position })}
      error={error}
      heart={
        track !== null && (
          <TrackHeart
            key={track.id}
            onFailure={() => setHeartNote(MUSIC_COPY.favouriteFailed)}
            session={session}
            track={track}
          />
        )
      }
      isPlaying={state === AUDIO_STATES.playing || state === AUDIO_STATES.loading}
      isShuffled={queue.isShuffled}
      note={note ?? heartNote}
      onAddToPlaylist={(pick) => {
        if (track !== null) addToPlaylist({ pick, tracks: [track] })
      }}
      onBack={() => router.back()}
      onClear={clear}
      onJump={jump}
      onNext={next}
      onPrevious={previous}
      onRemove={remove}
      onRepeat={cycleRepeat}
      onSeek={seekTo}
      onShuffle={toggleShuffle}
      onToggle={toggle}
      playlists={playlists}
      quality={quality}
      queue={rows}
      queueFacts={queueFactsOf(rows)}
      repeat={queue.repeat}
      duration={duration}
      position={position}
      track={playing}
    />
  )
}

/**
 * `/now-playing`: the cover large, the track with its heart and Add to playlist and the format
 * and quality of what plays, the transport, and a pane of two tabs: the queue under its
 * shuffle, repeat and Clear, each track playable or removable, and the lyrics or an
 * audiobook's chapters.
 */
export const NowPlaying = () => {
  const session = useAppQueries()
  return session !== null && <NowPlayingPage key={session.server.id} session={session} />
}
