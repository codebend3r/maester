import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MATCH_STATES,
  albumJumpScale,
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
import { useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { JumpPicker } from '@/components/JumpPicker/JumpPicker'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { SearchField } from '@/components/SearchField/SearchField'
import { libraryTracks } from '@/lib/music'
import { albumsQuery, artistsQuery } from '@/lib/queries'
import { useAddressSearch } from '@/lib/useSearch'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { api } from '@/lib/api'

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
  const cards = useRef<HTMLDivElement>(null)
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
  const scale = albumJumpScale({ sort, direction: order, albums: albums.data ?? [] })
  return (
    <div
      ref={cards}
      className={
        albums.data?.length && scale ? `${styles.section} ${styles.withJump}` : styles.section
      }
    >
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
      {albums.data && albums.data.length > 0 && scale && <JumpPicker scale={scale} scope={cards} />}
    </div>
  )
}

type UnmatchedAlbumsSectionProps = { library: Library }

/** Albums whose MusicBrainz match pass found no confident release, alphabetically. */
export const UnmatchedAlbumsSection = ({ library }: UnmatchedAlbumsSectionProps) => {
  const cards = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const list = albumsQuery({
    libraryId: library.id,
    search: '',
    sort: MUSIC_SORTS.title,
    order: SORT_DIRECTIONS.ascending,
    seed: 0,
  })
  const albums = useQuery({
    ...list,
    refetchInterval: (current) =>
      current.state.data?.some((album) => album.match === MATCH_STATES.pending) ? 2000 : false,
  })
  const unmatched = albums.data?.filter((album) => album.match === MATCH_STATES.unmatched) ?? []
  const scale = albumJumpScale({
    sort: MUSIC_SORTS.title,
    direction: SORT_DIRECTIONS.ascending,
    albums: unmatched,
  })
  const smartMatch = useMutation({
    mutationFn: () => api.matchLibrary(library.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: list.queryKey }),
  })
  return (
    <div ref={cards} className={scale ? `${styles.section} ${styles.withJump}` : styles.section}>
      <div className={styles.playlistsToolbar}>
        <AdminOnly>
          <Button
            icon="search"
            disabled={smartMatch.isPending || unmatched.length === 0}
            onClick={() => smartMatch.mutate()}
          >
            {LIBRARY_COPY.smartMatchAlbums}
          </Button>
        </AdminOnly>
      </div>
      {smartMatch.error && (
        <p className={styles.message} role="alert">
          {smartMatch.error.message}
        </p>
      )}
      {albums.isPending && <AlbumGridSkeleton />}
      {albums.error && (
        <p className={styles.message} role="alert">
          {albums.error.message}
        </p>
      )}
      {albums.data && unmatched.length === 0 && (
        <p className={styles.message}>{LIBRARY_COPY.noUnmatchedAlbums(library.name)}</p>
      )}
      {unmatched.length > 0 && <AlbumGrid albums={unmatched} />}
      {unmatched.length > 0 && scale && <JumpPicker scale={scale} scope={cards} />}
    </div>
  )
}

type ArtistsSectionProps = { library: Library }

/** A music library's artists by name, each with how many of its albums and tracks are theirs. */
export const ArtistsSection = ({ library }: ArtistsSectionProps) => {
  const search = useAddressSearch()
  const artists = useQuery(artistsQuery({ libraryId: library.id, search: search.query }))
  const albumArtists = artists.data?.filter(({ albumCount }) => albumCount > 0)
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
      {albumArtists && albumArtists.length === 0 && (
        <p className={styles.message}>{LIBRARY_COPY.noArtists(library.name)}</p>
      )}
      {albumArtists && albumArtists.length > 0 && (
        <ArtistList artists={albumArtists} label={LIBRARY_COPY.artists} />
      )}
    </div>
  )
}
