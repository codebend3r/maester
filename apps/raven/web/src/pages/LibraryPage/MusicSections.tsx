import { useMutation, useQuery } from '@tanstack/react-query'
import {
  type Library,
  MUSIC_SORTS,
  type MusicSort,
  QUEUE_SOURCE_KINDS,
  isMusicSort,
  MUSIC_LIST_PARAMS,
  MUSIC_DEFAULT_ORDERS,
  SORT_DIRECTIONS,
  type SortDirection,
  musicListQuery,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type Search, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog/PlaylistNameDialog'
import { SearchField } from '@/components/SearchField/SearchField'
import { libraryTracks, playlistFacts, playlistPath } from '@/lib/music'
import { albumsQuery, artistsQuery, playlistsQuery } from '@/lib/queries'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import { useAddressSearch } from '@/lib/useSearch'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type AlbumsToolbarProps = {
  library: Library
  search: Search
  sort: MusicSort
  order: SortDirection
  seed: number
  onSort: (sort: MusicSort) => void
  onOrder: () => void
  /** Whether there is anything to play. */
  isPlayable: boolean
}

/** Search, the sort, and Play and Shuffle, which queue the library's tracks in the order shown. */
const AlbumsToolbar = ({
  library,
  search,
  sort,
  order,
  seed,
  onSort,
  onOrder,
  isPlayable,
}: AlbumsToolbarProps) => {
  const playTracks = useAudioQueue((store) => store.playTracks)
  const play = useMutation({
    mutationFn: async (isShuffled: boolean) => {
      const tracks = await libraryTracks({
        libraryId: library.id,
        search: search.query,
        sort,
        order,
        seed,
      })
      if (tracks.length === 0) return
      playTracks({
        tracks,
        source: { kind: QUEUE_SOURCE_KINDS.library, id: library.id },
        isShuffled,
      })
    },
  })
  return (
    <div className={styles.musicToolbar}>
      <SearchField
        search={search}
        className={styles.musicSearch}
        aria-label={LIBRARY_COPY.searchLibrary(library.name)}
        placeholder={LIBRARY_COPY.searchAlbums}
      />
      <label className={styles.musicSort}>
        <span className="visually-hidden">{COMMON_COPY.sort}</span>
        <select
          value={sort}
          onChange={(event) => {
            if (isMusicSort(event.target.value)) onSort(event.target.value)
          }}
        >
          {Object.values(MUSIC_SORTS).map((key) => (
            <option key={key} value={key}>
              {LIBRARY_COPY.sortLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <Button
        className={styles.musicOrder}
        onClick={onOrder}
        disabled={sort === MUSIC_SORTS.random}
        aria-label={LIBRARY_COPY.reverseOrder}
      >
        {LIBRARY_COPY.directions[order]}
      </Button>
      <Button
        tone="primary"
        icon="play"
        className={styles.musicPlay}
        disabled={play.isPending || !isPlayable}
        onClick={() => play.mutate(false)}
      >
        {COMMON_COPY.play}
      </Button>
      <Button
        icon="shuffle"
        className={styles.musicShuffle}
        disabled={play.isPending || !isPlayable}
        onClick={() => play.mutate(true)}
      >
        {COMMON_COPY.shuffle}
      </Button>
      {play.error && (
        <p className={styles.message} role="alert">
          {LIBRARY_COPY.tracksFailed(play.error.message)}
        </p>
      )}
    </div>
  )
}

type AlbumsSectionProps = { library: Library }

/** A music library's albums: searched and sorted, with Play and Shuffle. */
export const AlbumsSection = ({ library }: AlbumsSectionProps) => {
  const search = useAddressSearch()
  const [address, setAddress] = useSearchParams()
  const decoded = musicListQuery.decode(address.toString())
  const sort = address.has(MUSIC_LIST_PARAMS.sort) ? decoded.sort : MUSIC_SORTS.artist
  const order = decoded.order ?? MUSIC_DEFAULT_ORDERS[sort]
  const seed = decoded.seed ?? 0
  const setSort = (next: MusicSort) =>
    setAddress((previous) => {
      const params = new URLSearchParams(previous)
      params.set(MUSIC_LIST_PARAMS.sort, next)
      params.set(MUSIC_LIST_PARAMS.order, MUSIC_DEFAULT_ORDERS[next])
      if (next === MUSIC_SORTS.random)
        params.set(MUSIC_LIST_PARAMS.seed, String(Date.now() % 1_000_000))
      return params
    })
  const reverse = () =>
    setAddress((previous) => {
      const params = new URLSearchParams(previous)
      params.set(
        MUSIC_LIST_PARAMS.order,
        order === SORT_DIRECTIONS.ascending
          ? SORT_DIRECTIONS.descending
          : SORT_DIRECTIONS.ascending,
      )
      return params
    })
  const albums = useQuery(
    albumsQuery({ libraryId: library.id, search: search.query, sort, order, seed }),
  )
  return (
    <div className={styles.section}>
      <AlbumsToolbar
        library={library}
        search={search}
        sort={sort}
        order={order}
        seed={seed}
        onSort={setSort}
        onOrder={reverse}
        isPlayable={(albums.data?.length ?? 0) > 0}
      />
      {albums.isPending && <AlbumGridSkeleton />}
      {albums.data && <output>{LIBRARY_COPY.albumCount(albums.data.length)}</output>}
      {albums.error && (
        <p className={styles.message} role="alert">
          {albums.error.message}
        </p>
      )}
      {albums.data && albums.data.length === 0 && (
        <p className={styles.message}>
          {search.query
            ? LIBRARY_COPY.noAlbumMatches({ name: library.name, query: search.query })
            : LIBRARY_COPY.noAlbums(library.name)}
        </p>
      )}
      {albums.data && albums.data.length > 0 && <AlbumGrid albums={albums.data} />}
    </div>
  )
}

type ArtistsSectionProps = { library: Library }

/** A music library's artists by name, each with how many of its albums and tracks are theirs. */
export const ArtistsSection = ({ library }: ArtistsSectionProps) => {
  const search = useAddressSearch()
  const artists = useQuery(artistsQuery({ libraryId: library.id, search: search.query }))
  return (
    <div className={styles.section}>
      <div className={styles.musicToolbar}>
        <SearchField
          search={search}
          className={styles.musicSearch}
          aria-label={LIBRARY_COPY.searchArtists}
          placeholder={LIBRARY_COPY.searchArtists}
        />
      </div>
      {artists.isPending && <output>{LIBRARY_COPY.loadingArtists}</output>}
      {artists.error && (
        <p className={styles.message} role="alert">
          {artists.error.message}
        </p>
      )}
      {artists.data && artists.data.length === 0 && (
        <p className={styles.message}>{LIBRARY_COPY.noArtists(library.name)}</p>
      )}
      {artists.data && artists.data.length > 0 && (
        <ArtistList artists={artists.data} label={LIBRARY_COPY.artists} />
      )}
    </div>
  )
}

/**
 * The account's own playlists, the same on every music library's tab as
 * they span them all, most recently changed first, and New playlist, which
 * opens the one it makes.
 */
export const PlaylistsSection = () => {
  const navigate = useNavigate()
  const playlists = useQuery(playlistsQuery)
  const { create } = usePlaylistMutations()
  const [isNaming, setNaming] = useState(false)
  return (
    <div className={styles.section}>
      <div className={styles.playlistsToolbar}>
        <Button tone="primary" icon="plus" onClick={() => setNaming(true)}>
          {LIBRARY_COPY.newPlaylist}
        </Button>
      </div>
      {playlists.error && (
        <p className={styles.message} role="alert">
          {playlists.error.message}
        </p>
      )}
      {playlists.data && playlists.data.length === 0 && (
        <p className={styles.message}>{LIBRARY_COPY.noPlaylists}</p>
      )}
      {playlists.data && playlists.data.length > 0 && (
        <ul className={styles.playlists} aria-label={LIBRARY_COPY.playlists}>
          {playlists.data.map((playlist) => (
            <li key={playlist.id} className={styles.playlist}>
              <Link to={playlistPath(playlist.id)} className={styles.playlistName}>
                {playlist.name}
              </Link>
              <span className={styles.playlistFacts}>
                {playlistFacts({ playlist }).join(COMMON_COPY.separator)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {isNaming && (
        <PlaylistNameDialog
          title={LIBRARY_COPY.newPlaylist}
          initialName=""
          submitLabel={LIBRARY_COPY.makePlaylist}
          isPending={create.isPending}
          error={create.error}
          onSubmit={(name) =>
            create.mutate(name, {
              onSuccess: (details) => void navigate(playlistPath(details.playlist.id)),
            })
          }
          onClose={() => setNaming(false)}
        />
      )}
    </div>
  )
}
