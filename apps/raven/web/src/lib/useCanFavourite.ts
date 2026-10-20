import { useQuery } from '@tanstack/react-query'
import { canFavouriteIn } from '@raven/core'
import { librariesQuery } from '@/lib/queries'

/**
 * Whether a library's videos can be favourites: not while it is locked,
 * whether or not the PIN is entered. Until the libraries are known, yes;
 * the server refuses a locked library's anyway.
 */
export const useCanFavourite = (libraryId: number): boolean =>
  useQuery({
    ...librariesQuery,
    select: (libraries) => canFavouriteIn({ libraries, libraryId }),
  }).data ?? true
