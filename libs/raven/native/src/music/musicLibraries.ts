import { LIBRARY_LISTINGS, type Library, listingFor } from '@raven/core'

/** The server's music libraries, the ones it lists by album, in its order. */
export const musicLibrariesOf = (libraries: readonly Library[]): Library[] =>
  libraries.filter((library) => listingFor(library.settings.kind) === LIBRARY_LISTINGS.albums)
