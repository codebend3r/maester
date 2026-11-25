import { type AlbumShelf, type HomeShelf, type ShelfOrders, isAnyShelfReleased } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import type { RavenQueries } from '@/query/ravenQueries'

type UseReleasedShelvesProps = { queries: RavenQueries; orders: ShelfOrders }

/** Each library's shelf by its newest releases, and each music library's albums; null until read. */
export type ReleasedShelves = {
  shelves: readonly HomeShelf[] | null
  albums: readonly AlbumShelf[] | null
}

/**
 * Home's shelves by their newest releases, for the shelves turned to Newly released. Nothing is
 * read while every shelf is on Recently added, which `GET /api/home` already answers.
 */
export const useReleasedShelves = ({
  queries,
  orders,
}: UseReleasedShelvesProps): ReleasedShelves => {
  const isRead = isAnyShelfReleased(orders)
  const shelves = useQuery({ ...queries.releasedShelvesQuery, enabled: isRead })
  const albums = useQuery({ ...queries.releasedAlbumsQuery, enabled: isRead })
  return { shelves: shelves.data ?? null, albums: albums.data ?? null }
}
