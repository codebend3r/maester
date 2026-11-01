import { type Library, libraryIconOf } from '@raven/core'

import type { MenuLibrary } from '@/layouts/shelfKit'

/** The pinned libraries as a side menu lists them, in the order the server gave them. */
export const pinnedLibrariesOf = (libraries: readonly Library[]): MenuLibrary[] =>
  libraries
    .filter((library) => library.settings.pinned)
    .map(({ id, name, settings }) => ({ id, name, icon: libraryIconOf(settings) }))
