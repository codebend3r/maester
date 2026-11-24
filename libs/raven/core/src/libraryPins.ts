import type { LibraryPin, ServerId } from '@/contract'

type PinnedIdsOnProps = { pins: readonly LibraryPin[]; serverId: ServerId | null }

/** The ids of the libraries the account pinned on one server; none for a server with no id. */
export const pinnedIdsOn = ({ pins, serverId }: PinnedIdsOnProps): number[] =>
  pins.filter((pin) => pin.serverId === serverId).map((pin) => pin.libraryId)

type PinnedLibrariesOnProps<T extends { id: number }> = {
  libraries: readonly T[]
  pins: readonly LibraryPin[]
  serverId: ServerId | null
}

/** A server's pinned libraries, in that server's own order of them. */
export const pinnedLibrariesOn = <T extends { id: number }>({
  libraries,
  pins,
  serverId,
}: PinnedLibrariesOnProps<T>): T[] => {
  const ids = pinnedIdsOn({ pins, serverId })
  return libraries.filter((library) => ids.includes(library.id))
}

type PinnedShelvesOfProps<T extends { libraryId: number }> = {
  shelves: readonly T[]
  /** The libraries pinned on the server the shelves are from (`pinnedIdsOn`). */
  pinnedHere: readonly number[]
}

/**
 * Home's shelves of the libraries the account pinned on this server, or every library's while it
 * pinned none here. The server sends a shelf for every library it lets the account see; the pins
 * are the account's own, kept beside the servers, so they choose.
 */
export const pinnedShelvesOf = <T extends { libraryId: number }>({
  shelves,
  pinnedHere,
}: PinnedShelvesOfProps<T>): T[] =>
  pinnedHere.length === 0
    ? [...shelves]
    : shelves.filter((shelf) => pinnedHere.includes(shelf.libraryId))

type PinsToggledProps = {
  pins: readonly LibraryPin[]
  serverId: ServerId
  libraryId: number
  shouldPin: boolean
  /** When the pin is made, as its database will stamp it. */
  pinnedAt: string
}

/** The account's pins with one library pinned or unpinned, as they will read once the database has it. */
export const pinsToggled = ({
  pins,
  serverId,
  libraryId,
  shouldPin,
  pinnedAt,
}: PinsToggledProps): LibraryPin[] => {
  const others = pins.filter((pin) => pin.serverId !== serverId || pin.libraryId !== libraryId)
  return shouldPin ? [...others, { serverId, libraryId, pinnedAt }] : others
}
