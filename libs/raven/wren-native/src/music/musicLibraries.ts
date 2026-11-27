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

/** The app's prefs once its root has handed them over; null until then. */
type ConfiguredChoice = { prefs: ReadOnlyStore<LibraryPick> | null }

const useLibraryChoice = create<ConfiguredChoice>()(() => ({ prefs: null }))

/** What a release build reads when no prefs were handed over: no pick, so the server's first. */
const NO_PICK = createStore<LibraryPick>()(() => ({ libraryId: null }))

/**
 * Hands the listings the app's prefs, which keep its pick of music library. Each app's root
 * calls it as it loads its stores, before any route mounts.
 */
export const configureLibraryChoice = (choice: LibraryChoice): void => {
  useLibraryChoice.setState(choice)
}

/*
 * The prefs the listings read. A development build fails loudly when the root never handed
 * them over, since the listings would quietly ignore the library picked in Settings.
 */
const pickedPrefsOf = (prefs: ConfiguredChoice['prefs']): ReadOnlyStore<LibraryPick> => {
  if (prefs !== null) return prefs
  if (__DEV__) throw new Error('useMusicLibraries ran before configureLibraryChoice was called')
  return NO_PICK
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
  const prefs = pickedPrefsOf(useLibraryChoice((state) => state.prefs))
  const libraryId = useStore(prefs, (state) => state.libraryId)
  const all = musicLibrariesOf(libraries.data ?? NO_LIBRARIES)
  return {
    libraries: wornLibrariesOf({ libraries: all, libraryId }),
    all,
    isRead: libraries.isSuccess,
    failure: libraries.error,
  }
}
