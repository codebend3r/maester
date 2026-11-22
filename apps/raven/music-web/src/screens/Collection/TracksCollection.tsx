import { type Track, plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, type ListState } from '@raven/wren'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { useFinishedTracks, useInProgressTracks } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { TrackActions, TrackList } from '@/screens/Collection/TrackList'
import { Page } from '@/shell/Page/Page'
import collectionStyles from '@/screens/Collection/Collection.module.scss'

type TracksPageProps = {
  title: string
  /** What the page says when it lists none. */
  empty: string
  tracks: readonly Track[]
  listing: ListState
}

/** A category of songs: its title and count, Play and Shuffle, then a row for each song, which plays the list from there. */
function TracksPage({ title, empty, tracks, listing }: TracksPageProps) {
  const isCounted = listing.isRead && tracks.length > 0
  return (
    <Page className={collectionStyles.songs}>
      <CollectionHeader
        count={isCounted ? plural({ n: tracks.length, ...COUNTS_COPY.songs }) : null}
        title={title}
      >
        {tracks.length > 0 && <TrackActions tracks={tracks} />}
      </CollectionHeader>
      {tracks.length === 0 && (
        <ListNotice empty={empty} listing={listing} shape={LIST_SHAPES.rows} />
      )}
      <TrackList tracks={tracks} />
    </Page>
  )
}

/** In progress: the songs left partway through in every music library, as raven's tab lists them. */
export function InProgressCollection() {
  const { tracks, listing } = useInProgressTracks()
  return (
    <TracksPage
      empty={LIBRARY_PAGE_COPY.noInProgress}
      listing={listing}
      title={LIBRARY_PAGE_COPY.inProgress}
      tracks={tracks}
    />
  )
}

/** Recently finished: the songs played to their end most recently in every music library. */
export function FinishedCollection() {
  const { tracks, listing } = useFinishedTracks()
  return (
    <TracksPage
      empty={LIBRARY_PAGE_COPY.noFinished}
      listing={listing}
      title={LIBRARY_PAGE_COPY.finished}
      tracks={tracks}
    />
  )
}
