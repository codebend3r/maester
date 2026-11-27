import type { Track } from '@raven/core'
import {
  SONG_PROGRESS_KEY,
  type SongProgress,
  mergedSongProgressOf,
  songNoteOf,
  withSongNote,
} from '@raven/wren'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** One moment of a song's play, as the player reports it. */
type NoteSongProps = {
  serverId: string
  track: Pick<Track, 'id' | 'albumId' | 'libraryId' | 'duration'>
  /** Seconds in. */
  position: number
}

type SongProgressState = {
  songs: SongProgress[]
  /** Notes where a song is: partway, at its end, or not yet begun, which changes nothing. */
  note: (props: NoteSongProps) => void
  clear: () => void
}

/**
 * Each song's progress in this browser alone, persisted to localStorage and guarded when read:
 * where it was left partway and when, and when it last played to its end. Nothing of it goes to
 * the server, so another device keeps its own.
 */
export const useSongProgress = create<SongProgressState>()(
  persist(
    (set) => ({
      songs: [],
      note: ({ serverId, track, position }) =>
        set(({ songs }) => ({
          songs: withSongNote({
            songs,
            serverId,
            track,
            note: songNoteOf({ position, duration: track.duration }),
            at: new Date().toISOString(),
          }),
        })),
      clear: () => set({ songs: [] }),
    }),
    {
      name: SONG_PROGRESS_KEY,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ songs }) => ({ songs }),
      // What played before the kept progress was read stands over what was read.
      merge: (saved, current) => ({
        ...current,
        songs: mergedSongProgressOf({ current: current.songs, saved }),
      }),
    },
  ),
)
