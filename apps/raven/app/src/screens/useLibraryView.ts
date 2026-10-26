import {
  LIBRARY_VIEWS,
  type Library,
  type LibrarySettings,
  type LibraryView,
  MEDIA_SORTS,
  coherentSettings,
  viewsFor,
} from '@raven/core'
import { useState } from 'react'

import { type LibraryChoice, libraryChoiceOf, useLibraryViews } from '@/stores/libraryViews'

/**
 * The web's bare covers have no layout here yet, so a library left on them shows the grid
 * and the view picker does not offer them.
 */
const shownView = (view: LibraryView): LibraryView =>
  view === LIBRARY_VIEWS.covers ? LIBRARY_VIEWS.grid : view

/** The views the app offers for a type of library: the web's, but the covers. */
export const appViewsFor = (kind: Parameters<typeof viewsFor>[0]): LibraryView[] =>
  viewsFor(kind).filter((view) => view !== LIBRARY_VIEWS.covers)

/** A fresh deal for a random sort; the order holds while the library is open. */
const dealSeed = (): number => Math.floor(Math.random() * 2 ** 31)

type UseLibraryViewProps = {
  serverId: string
  library: Library
}

/**
 * How a library is looked at on this device: the server's settings under what was chosen
 * here (see `useLibraryViews`), made coherent with its type, and the way to choose again.
 */
export const useLibraryView = ({
  serverId,
  library,
}: UseLibraryViewProps): {
  settings: LibrarySettings
  /** The random sort's deal; 0 for every other sort, so they share a cache entry. */
  seed: number
  change: (change: LibraryChoice) => void
} => {
  const choice = useLibraryViews((state) =>
    libraryChoiceOf({ choices: state.choices, serverId, libraryId: library.id }),
  )
  const choose = useLibraryViews((state) => state.choose)
  const [seed] = useState(dealSeed)
  const coherent = coherentSettings({ ...library.settings, ...choice })
  const settings = { ...coherent, view: shownView(coherent.view) }
  return {
    settings,
    seed: settings.sort === MEDIA_SORTS.random ? seed : 0,
    change: (change) => choose({ serverId, libraryId: library.id, change }),
  }
}
