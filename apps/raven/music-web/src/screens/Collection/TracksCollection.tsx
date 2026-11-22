import { type Track, artistNames, formatDuration, plural } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, type ListState, SONG_LEADS } from '@raven/wren'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { useFavouriteTracks, useFinishedTracks, useInProgressTracks } from '@/music/listings'
import { useCovers } from '@/music/useCovers'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { Page } from '@/shell/Page/Page'
import collectionStyles from '@/screens/Collection/Collection.module.scss'
import styles from '@/screens/Collection/TracksCollection.module.scss'

type TracksPageProps = {
  title: string
  /** What the page says when it lists none. */
  empty: string
  tracks: readonly Track[]
  listing: ListState
}

/** A category of songs: its title and count, Play and Shuffle, then a row for each song, which plays the list from there. */
function TracksPage({ title, empty, tracks, listing }: TracksPageProps) {
  const { trackCoverOf } = useCovers()
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playingId = useAudioQueue(playingIdOf)
  const isCounted = listing.isRead && tracks.length > 0
  return (
    <Page className={collectionStyles.songs}>
      <CollectionHeader
        count={isCounted ? plural({ n: tracks.length, ...COUNTS_COPY.songs }) : null}
        title={title}
      >
        {tracks.length > 0 && (
          <div className={styles.actions}>
            <PlayButtons
              onPlay={() => playTracks({ tracks })}
              onShuffle={() => playTracks({ tracks, isShuffled: true })}
            />
          </div>
        )}
      </CollectionHeader>
      {tracks.length === 0 && <ListNotice empty={empty} listing={listing} />}
      <ul className={styles.list}>
        {tracks.map((track, index) => (
          <li className={styles.row} key={track.id}>
            <TrackRow
              isCurrent={track.id === playingId}
              label={track.title}
              lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(track) }}
              length={formatDuration(track.duration)}
              onPress={() => playTracks({ tracks, startAt: index })}
              subtitle={artistNames(track)}
              track={track}
            />
          </li>
        ))}
      </ul>
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

/** Favourites: the songs marked a favourite in every music library, as raven's tab lists them. */
export function FavouritesCollection() {
  const { tracks, listing } = useFavouriteTracks()
  return (
    <TracksPage
      empty={LIBRARY_PAGE_COPY.noFavourites}
      listing={listing}
      title={LIBRARY_PAGE_COPY.favourites}
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
