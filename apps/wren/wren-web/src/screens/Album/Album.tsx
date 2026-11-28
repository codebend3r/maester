import {
  type AlbumDetails,
  type AlbumTrack,
  QUEUE_SOURCE_KINDS,
  albumDiscsOf,
  artistNames,
} from '@raven/core'
import { useServerAlbumFavourite } from '@raven/ui/headless'
import { ALBUM_COPY, PLAYER_COPY, SONG_LEADS, albumMetaOf } from '@raven/wren'
import { FavouriteAction } from '@/components/FavouriteAction/FavouriteAction'
import { TracksMenu } from '@/components/TrackMenu/TrackMenu'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'
import { useCovers } from '@/music/useCovers'
import { ArtistLinks } from '@/screens/Album/ArtistLinks'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { DetailTrackRow } from '@/screens/detail/DetailTrackRow'
import { DetailTracks } from '@/screens/detail/DetailTracks'
import { QueueAction } from '@/screens/detail/QueueAction'
import { useTracklist } from '@/screens/detail/useTracklist'
import { toastFailure } from '@/stores/toast'
import styles from '@/screens/Album/Album.module.scss'

type AlbumPageProps = { details: AlbumDetails }

function AlbumPage({ details }: AlbumPageProps) {
  const { coverOf } = useCovers()
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api, albumId: album.id })
  const { playingId, play, shuffle, playFrom, queue, isMenuOpen, openMenu, closeMenu } =
    useTracklist({
      tracks,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: album.id },
      queued: ALBUM_COPY.queued(album.title),
    })
  const cover = coverOf({ albumId: album.id, coverVersion: album.coverVersion })
  const discs = albumDiscsOf({ tracks, discCount })
  const toggleFavourite = () =>
    favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  const renderRow = (item: AlbumTrack) => (
    <DetailTrackRow
      isCurrent={item.id === playingId}
      key={item.key}
      label={item.label}
      lead={{ kind: SONG_LEADS.number, number: item.number }}
      length={item.length}
      onPress={() => playFrom(item.index)}
      track={item.track}
    />
  )
  return (
    <>
      <DetailSplit
        head={
          <CollectionHead
            actions={
              <>
                <FavouriteAction
                  isOn={isFavourite}
                  label={PLAYER_COPY.like}
                  onToggle={toggleFavourite}
                />
                <QueueAction onPress={queue} />
              </>
            }
            byline={<ArtistLinks artists={album.artists} />}
            cover={cover}
            meta={albumMetaOf({ details })}
            onMore={openMenu}
            onPlay={play}
            onShuffle={shuffle}
            title={album.title}
          />
        }
      >
        {discs.map((disc) => (
          <section className={styles.disc} key={disc.key}>
            {disc.title !== null && <h2 className={styles.discTitle}>{disc.title}</h2>}
            <DetailTracks>{disc.tracks.map(renderRow)}</DetailTracks>
          </section>
        ))}
      </DetailSplit>
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist
          head={{ title: album.title, subtitle: artistNames(album), cover }}
          onClose={closeMenu}
          places={{ artists: album.artists }}
          tracksOf={async () => tracks}
        />
      )}
    </>
  )
}

/**
 * `/album/:id`: the cover, the artists and the facts, Play and Shuffle, Like and Queue, and the
 * tracks by disc; from `48rem` the head and the tracklist side by side.
 */
export function Album() {
  return (
    <DetailRoute copy={ALBUM_COPY} queryOf={queries.albumQuery}>
      {(details) => <AlbumPage details={details} />}
    </DetailRoute>
  )
}
