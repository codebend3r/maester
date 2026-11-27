import type { Track } from '@raven/core'
import { accountIdOf, loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import {
  SONG_PROGRESS_KEY,
  type SongProgress,
  mergedSongProgressOf,
  songNoteOf,
  withSongNote,
} from '@raven/wren'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

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
 * Each song's progress on this device alone, persisted to AsyncStorage and guarded when read:
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
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ songs }) => ({ songs }),
      // What played before the kept progress was read stands over what was read.
      merge: (saved, current) => ({
        ...current,
        songs: mergedSongProgressOf({ current: current.songs, saved }),
      }),
    },
  ),
)

type ConfigureSongProgressProps = { storage: StateStorage }

/** Gives the songs' progress its storage, AsyncStorage in the app, and reads it back from it. */
export const configureSongProgress = async ({ storage }: ConfigureSongProgressProps) => {
  await loadPersisted({ store: useSongProgress, storage })
}

/** Who is signed in, as an account session store holds it. */
type AccountState = Parameters<typeof accountIdOf>[0]

/** Hears each change of the account session, with the state before it. */
type AccountListener = (state: AccountState, previous: AccountState) => void

/** The slice of an account session store the forgetting reads: each change, until it stops. */
type WatchedAccount = { subscribe: (listener: AccountListener) => () => void }

type ForgetSongProgressProps = {
  /** Who is signed in: Wren's account session, `useWrenAccount`. */
  session: WatchedAccount
}

/**
 * Forgets the songs' progress whenever a signed-in account signs out or gives way to another, as
 * the web forgets its own, so the next account never sees what the last one played. A first
 * sign-in, or the session read back as the app starts, keeps it. Hands back the way to stop.
 */
export const forgetSongProgressOnAccountChange = ({
  session,
}: ForgetSongProgressProps): (() => void) =>
  session.subscribe((state, previous) => {
    const was = accountIdOf(previous)
    if (was === null || was === accountIdOf(state)) return
    useSongProgress.getState().clear()
  })
