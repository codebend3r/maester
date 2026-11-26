import { plural } from '@raven/core'
import {
  COUNTS_COPY,
  FIRST_LIST_ORDER,
  LIBRARY_PAGE_COPY,
  type ListOrder,
  listOrderOf,
} from '@raven/wren'
import { useState } from 'react'

import { useAllSongs, useSongCount, useCollectionSearch } from '@raven/wren-native'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { PlayButtons } from '@/components/PlayButtons'
import { SortButton } from '@/screens/library/SortButton'
import { TracksPage } from '@/screens/library/TracksPage'

/**
 * Songs: every music library's tracks a page at a time, in the order picked and found by what is
 * typed, both by the server. Play and Shuffle play what has been read so far.
 */
export function SongsCollection({ session }: CollectionPageProps) {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchSongs,
    none: LIBRARY_PAGE_COPY.noSongs,
  })
  const [order, setOrder] = useState<ListOrder>(FIRST_LIST_ORDER)
  const n = useSongCount({ session, search: search.query })
  const { tracks, listing, nextPage } = useAllSongs({ session, search: search.query, order })
  return (
    <TracksPage
      empty={search.empty}
      header={
        <CollectionHeader
          count={n === null ? null : plural({ n, ...COUNTS_COPY.songs })}
          search={search.field}
          title={LIBRARY_PAGE_COPY.songs}
        >
          <SortButton onSort={(sort) => setOrder(listOrderOf(sort))} sort={order.sort} />
          {tracks.length > 0 && <PlayButtons tracksOf={async () => tracks} />}
        </CollectionHeader>
      }
      listing={listing}
      onEndReached={nextPage}
      session={session}
      tracks={tracks}
    />
  )
}
