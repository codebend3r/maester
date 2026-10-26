import type { HomeShelf, Library } from '@/contract'

type WithLibrariesProps = {
  shelves: readonly HomeShelf[]
  libraries: readonly Library[]
}

/** Each shelf with the library it is for; a shelf for a library not in the list is left out. */
export const withLibraries = ({
  shelves,
  libraries,
}: WithLibrariesProps): Array<{ shelf: HomeShelf; library: Library }> =>
  shelves.flatMap((shelf) => {
    const library = libraries.find(({ id }) => id === shelf.libraryId)
    return library === undefined ? [] : [{ shelf, library }]
  })
