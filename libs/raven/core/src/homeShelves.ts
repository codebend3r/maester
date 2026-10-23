import type { HomeShelf, Library } from '@/contract'

/** Each shelf with the library it is for; a shelf for a library not in the list is left out. */
export const withLibraries = ({
  shelves,
  libraries,
}: {
  shelves: readonly HomeShelf[]
  libraries: readonly Library[]
}): Array<{ shelf: HomeShelf; library: Library }> =>
  shelves.flatMap((shelf) => {
    const library = libraries.find(({ id }) => id === shelf.libraryId)
    return library === undefined ? [] : [{ shelf, library }]
  })
