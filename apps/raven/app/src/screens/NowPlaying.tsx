import { NO_LYRICS, artistNames } from '@raven/core'
import {
  AUDIO_STATES,
  chapterAt,
  nextChapterStart,
  playingTrackOf,
  previousChapterStart,
  useAudioQueue,
  useAudiobookChapters,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { NowPlayingLayout } from '@/layouts'
import type { BookControls } from '@/layouts/musicKit'
import { chapterRowsOf, nowPlayingAsideOf, playTimeOf, queueRowsOf } from '@/layouts/musicRows'
import { trackCoverOf } from '@/music/musicCards'
import { usePlaylistAdd } from '@/music/usePlaylistAdd'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'

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
  const playing =
    track === null
      ? null
      : {
          title: track.title,
          artists: artistNames(track),
          album: track.album.title,
          cover:
            pictures === null
              ? null
              : trackCoverOf({ api, headersFor: pictures.headersFor, track }),
        }
  const nextStart = nextChapterStart({ chapters, at: position })
  const book: BookControls | null = isAudiobook
    ? {
        chapters: chapterRowsOf({ chapters, current: chapterAt({ chapters, at: position }) }),
        speed,
        onChapter: seekTo,
        onPreviousChapter: () => seekTo(previousChapterStart({ chapters, at: position })),
        onNextChapter: nextStart === null ? null : () => seekTo(nextStart),
        onSpeed: setSpeed,
      }
    : null
  // A failed read is said as no lyrics, quietly.
  const shownLyrics = lyrics.data ?? (lyrics.isError ? NO_LYRICS : null)
  return (
    <NowPlayingLayout
      aside={nowPlayingAsideOf({ book, lyrics: shownLyrics, at: position })}
      error={error}
      isPlaying={state === AUDIO_STATES.playing || state === AUDIO_STATES.loading}
      isShuffled={queue.isShuffled}
      note={note}
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
      onShuffle={toggleShuffle}
      onToggle={toggle}
      playlists={playlists}
      queue={queueRowsOf({ queue, tracks })}
      repeat={queue.repeat}
      time={playTimeOf({ position, duration })}
      track={playing}
    />
  )
}

/**
 * `/now-playing`: the cover large, the controls, the lyrics or an audiobook's chapters and
 * speed, and the queue, each track playable or removable.
 */
export const NowPlaying = () => {
  const session = useAppQueries()
  if (session === null) return null
  return <NowPlayingPage key={session.server.id} session={session} />
}
