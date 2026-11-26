import type { PosterEntry } from '@raven/core'
import { type SignedInShelfProps, useTopShelf } from '@raven/top-shelf'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { showArtIdsOf } from '@/queries/showArt'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { useShowArts } from '@/queries/useShowArts'
import { continueShelfOf } from '@/topShelf/topShelf'

// One empty list while Home is read, so the art's ids are not worked out again for a new one.
const NO_ENTRIES: readonly PosterEntry[] = []

/** Keeps raven's Top Shelf on Continue watching, read through the cache Home reads it from. */
export const ContinueShelf = ({ session }: SignedInShelfProps<AppQueries>) => {
  const home = useQuery(session.queries.homeQuery)
  const pictures = usePictures(session)
  const entries = home.data?.inProgress ?? NO_ENTRIES
  const arts = useShowArts({ queries: session.queries, ids: showArtIdsOf(entries), pictures })
  const shelf = useMemo(
    () =>
      home.data === undefined || pictures === null
        ? null
        : continueShelfOf({ entries: home.data.inProgress, arts, ...pictures }),
    [home.data, arts, pictures],
  )
  useTopShelf(shelf)
  return null
}
