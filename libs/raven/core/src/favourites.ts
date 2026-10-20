import type { Library } from '@/contract'

/**
 * Whether a library's videos can be favourites: not while it is locked,
 * whether or not the PIN is entered. A library not among `libraries` can;
 * the server refuses a locked library's anyway.
 */
export const canFavouriteIn = ({
  libraries,
  libraryId,
}: {
  libraries: readonly Library[]
  libraryId: number
}): boolean => !libraries.some((library) => library.id === libraryId && library.settings.locked)
