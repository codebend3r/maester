import { type Library, type LibrarySettings, MEDIA_SORTS, coherentSettings } from '@raven/core'
import { useState } from 'react'

import { type LibraryChoice, libraryChoiceOf, useLibraryViews } from '@/stores/libraryViews'

/** A fresh deal for a random sort; the order holds while the library is open. */
const dealSeed = (): number => Math.floor(Math.random() * 2 ** 31)

/**
 * How a library is looked at on this device: the server's settings under what was chosen
 * here (see `useLibraryViews`), made coherent with its type, and the way to choose again.
 */
export const useLibraryView = ({
  serverId,
  library,
}: {
  serverId: string
  library: Library
}): {
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
  const settings = coherentSettings({ ...library.settings, ...choice })
  return {
    settings,
    seed: settings.sort === MEDIA_SORTS.random ? seed : 0,
    change: (change) => choose({ serverId, libraryId: library.id, change }),
  }
}
