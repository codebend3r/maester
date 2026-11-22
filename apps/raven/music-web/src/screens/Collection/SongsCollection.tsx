import { plural } from '@raven/core'
import {
  COUNTS_COPY,
  FIRST_LIST_ORDER,
  LIBRARY_PAGE_COPY,
  type ListOrder,
  listOrderOf,
} from '@raven/wren'
import { useState } from 'react'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { useAllSongs, useSongCount } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { SortButton } from '@/screens/Collection/SortButton'
import { TrackActions, TrackList } from '@/screens/Collection/TrackList'
import { useCollectionSearch } from '@/screens/Collection/useCollectionSearch'
import { ListEnd } from '@/ui/ListEnd/ListEnd'
import { Page } from '@/shell/Page/Page'
import collectionStyles from '@/screens/Collection/Collection.module.scss'

/**
 * Songs: every music library's tracks a page at a time, in the order picked and found by what
 * is typed, both by the server. Play and Shuffle play what has been read so far.
 */
export function SongsCollection() {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchSongs,
    none: LIBRARY_PAGE_COPY.noSongs,
  })
  const [order, setOrder] = useState<ListOrder>(FIRST_LIST_ORDER)
  const n = useSongCount({ search: search.query })
  const { tracks, listing, nextPage } = useAllSongs({ search: search.query, order })
  return (
    <Page className={collectionStyles.songs}>
      <CollectionHeader
        count={n === null ? null : plural({ n, ...COUNTS_COPY.songs })}
        search={search.field}
        title={LIBRARY_PAGE_COPY.songs}
        tools={<SortButton onSort={(sort) => setOrder(listOrderOf(sort))} sort={order.sort} />}
      >
        {tracks.length > 0 && <TrackActions tracks={tracks} />}
      </CollectionHeader>
      {tracks.length === 0 && (
        <ListNotice empty={search.empty} listing={listing} shape={LIST_SHAPES.rows} />
      )}
      <TrackList tracks={tracks} />
      <ListEnd count={tracks.length} onEndReached={nextPage} />
    </Page>
  )
}
