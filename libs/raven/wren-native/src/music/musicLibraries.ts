import { type Library, musicLibrariesOf } from '@raven/core'
import { wornLibrariesOf } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { type StoreApi, create, createStore, useStore } from 'zustand'

import { type WrenSession } from '@/useWren'

const NO_LIBRARIES: readonly Library[] = []

/** What the listings read of an app's prefs: the music library picked in Settings, null for the server's first. */
type LibraryPick = { libraryId: number | null }

/** A store read and never written here, as `useStore` reads one. */
type ReadOnlyStore<State> = Pick<StoreApi<State>, 'getState' | 'getInitialState' | 'subscribe'>

type LibraryChoice = { prefs: ReadOnlyStore<LibraryPick> }

const useLibraryChoice = create<LibraryChoice>()(() => ({
  prefs: createStore<LibraryPick>()(() => ({ libraryId: null })),
}))

/** Hands the listings the app's prefs, which keep its pick of music library. */
export const configureLibraryChoice = (choice: LibraryChoice): void => {
  useLibraryChoice.setState(choice)
}

type UseMusicLibrariesProps = Pick<WrenSession, 'queries'>

/**
 * The music library Wren shows, as the list every listing reads: the one picked in Settings,
 * else the server's first; empty while the libraries are read. `all` is every music library the
 * server has, in its order, for the place that picks one. `isRead` says whether they have been
 * read, and `failure` why they could not be.
 */
export const useMusicLibraries = ({ queries }: UseMusicLibrariesProps) => {
  const libraries = useQuery(queries.librariesQuery)
  const prefs = useLibraryChoice((state) => state.prefs)
  const libraryId = useStore(prefs, (state) => state.libraryId)
  const all = musicLibrariesOf(libraries.data ?? NO_LIBRARIES)
  return {
    libraries: wornLibrariesOf({ libraries: all, libraryId }),
    all,
    isRead: libraries.isSuccess,
    failure: libraries.error,
  }
}
