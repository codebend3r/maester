import type { Library } from '@/contract'

/** Anything that stands for a library's row: it names the library it is for. */
type LibraryRow = { libraryId: number }

type WithLibrariesProps<S extends LibraryRow> = {
  shelves: readonly S[]
  libraries: readonly Library[]
}

/** Each shelf with the library it is for; a shelf for a library not in the list is left out. */
export const withLibraries = <S extends LibraryRow>({
  shelves,
  libraries,
}: WithLibrariesProps<S>): Array<{ shelf: S; library: Library }> =>
  shelves.flatMap((shelf) => {
    const library = libraries.find(({ id }) => id === shelf.libraryId)
    return library === undefined ? [] : [{ shelf, library }]
  })
