import { isNumber, nullable } from '@raven/core'

/** The library a listener picked in Settings, by its id; null until one is, which wears the server's first. */
export const isLibraryPick = nullable(isNumber)

type WornLibraryOfProps<L> = {
  /** The server's music libraries, in its order. */
  libraries: readonly L[]
  /** The library picked in Settings, or null for none yet. */
  libraryId: number | null
}

/**
 * The library Wren shows, as the list every listing reads: the one picked while the server still
 * has it, else the server's first, and none when the server has no music library at all.
 */
export const wornLibrariesOf = <L extends { id: number }>({
  libraries,
  libraryId,
}: WornLibraryOfProps<L>): L[] => {
  const worn = libraries.find(({ id }) => id === libraryId) ?? libraries[0]
  return worn === undefined ? [] : [worn]
}
