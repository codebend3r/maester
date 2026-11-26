import { type Track, plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, type ListState } from '@raven/wren'

import { useFinishedTracks, useInProgressTracks } from '@raven/wren-native'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { PlayButtons } from '@/components/PlayButtons'
import { TracksPage } from '@/screens/library/TracksPage'

type SongsListProps = CollectionPageProps & {
  title: string
  empty: string
  tracks: readonly Track[]
  listing: ListState
}

/** A category of songs: its title and count, Play and Shuffle, then a row for each song. */
function SongsList({ session, title, empty, tracks, listing }: SongsListProps) {
  const isCounted = listing.isRead && tracks.length > 0
  return (
    <TracksPage
      empty={empty}
      header={
        <CollectionHeader
          count={isCounted ? plural({ n: tracks.length, ...COUNTS_COPY.songs }) : null}
          title={title}
        >
          {tracks.length > 0 && <PlayButtons tracksOf={async () => tracks} />}
        </CollectionHeader>
      }
      listing={listing}
      session={session}
      tracks={tracks}
    />
  )
}

/** In progress: the songs left partway through in every music library, as raven's tab lists them. */
export function InProgressCollection({ session }: CollectionPageProps) {
  const { tracks, listing } = useInProgressTracks(session)
  return (
    <SongsList
      empty={LIBRARY_PAGE_COPY.noInProgress}
      listing={listing}
      session={session}
      title={LIBRARY_PAGE_COPY.inProgress}
      tracks={tracks}
    />
  )
}

/** Recently finished: the songs played to their end most recently in every music library. */
export function FinishedCollection({ session }: CollectionPageProps) {
  const { tracks, listing } = useFinishedTracks(session)
  return (
    <SongsList
      empty={LIBRARY_PAGE_COPY.noFinished}
      listing={listing}
      session={session}
      title={LIBRARY_PAGE_COPY.finished}
      tracks={tracks}
    />
  )
}
