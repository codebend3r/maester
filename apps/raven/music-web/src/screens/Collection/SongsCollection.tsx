import { artistNames, formatDuration, plural } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, LIST_SORTS, type ListSort, SONG_LEADS } from '@raven/wren'
import { useState } from 'react'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { useAllSongs, useSongCount } from '@/music/listings'
import { useCovers } from '@/music/useCovers'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { useCollectionSearch } from '@/screens/Collection/useCollectionSearch'
import { ListEnd } from '@/ui/ListEnd/ListEnd'
import { Page } from '@/shell/Page/Page'
import collectionStyles from '@/screens/Collection/Collection.module.scss'
import styles from '@/screens/Collection/SongsCollection.module.scss'

/**
 * Songs: every music library's tracks a page at a time, in the order picked and found by what
 * is typed, both by the server. Play and Shuffle play what has been read so far.
 */
export function SongsCollection() {
  const { trackCoverOf } = useCovers()
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchSongs,
    none: LIBRARY_PAGE_COPY.noSongs,
  })
  const [sort, setSort] = useState<ListSort>(LIST_SORTS.title)
  const n = useSongCount({ search: search.query })
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playingId = useAudioQueue(playingIdOf)
  const { tracks, listing, nextPage } = useAllSongs({ search: search.query, sort })
  return (
    <Page className={collectionStyles.songs}>
      <CollectionHeader
        count={n === null ? null : plural({ n, ...COUNTS_COPY.songs })}
        search={search.field}
        sort={{ sort, onSort: setSort }}
        title={LIBRARY_PAGE_COPY.songs}
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
      {tracks.length === 0 && <ListNotice empty={search.empty} listing={listing} />}
      <ul className={styles.list}>
        {tracks.map((track, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- a page read while the library changes can repeat a song, as the apps' list keys allow
          <li className={styles.row} key={`${track.id}:${index}`}>
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
      <ListEnd count={tracks.length} onEndReached={nextPage} />
    </Page>
  )
}
