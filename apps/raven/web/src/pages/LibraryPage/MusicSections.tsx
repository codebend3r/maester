import { useMutation, useQuery } from '@tanstack/react-query'
import {
  type Library,
  MUSIC_SORTS,
  type MusicSort,
  QUEUE_SOURCE_KINDS,
  isMusicSort,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type Search, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { SearchField } from '@/components/SearchField/SearchField'
import { artistPath, libraryTracks } from '@/lib/music'
import { albumsQuery, artistsQuery } from '@/lib/queries'
import { useAddressSearch } from '@/lib/useSearch'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const SORT_LABELS: Record<MusicSort, string> = {
  title: 'Title',
  artist: 'Artist',
  year: 'Year',
  added: 'Recently added',
}

type AlbumsToolbarProps = {
  library: Library
  search: Search
  sort: MusicSort
  onSort: (sort: MusicSort) => void
  /** Whether there is anything to play. */
  isPlayable: boolean
}

/** Search, the sort, and Play and Shuffle, which queue the library's tracks in the order shown. */
const AlbumsToolbar = ({ library, search, sort, onSort, isPlayable }: AlbumsToolbarProps) => {
  const playTracks = useAudioQueue((store) => store.playTracks)
  const play = useMutation({
    mutationFn: async (isShuffled: boolean) => {
      const tracks = await libraryTracks({ libraryId: library.id, search: search.query, sort })
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
        aria-label={`Search ${library.name}`}
        placeholder="Search albums and artists"
      />
      <label className={styles.musicSort}>
        <span className="visually-hidden">Sort</span>
        <select
          value={sort}
          onChange={(event) => {
            if (isMusicSort(event.target.value)) onSort(event.target.value)
          }}
        >
          {Object.values(MUSIC_SORTS).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <Button
        tone="primary"
        icon="play"
        className={styles.musicPlay}
        disabled={play.isPending || !isPlayable}
        onClick={() => play.mutate(false)}
      >
        Play
      </Button>
      <Button
        icon="shuffle"
        className={styles.musicShuffle}
        disabled={play.isPending || !isPlayable}
        onClick={() => play.mutate(true)}
      >
        Shuffle
      </Button>
      {play.error && (
        <p className={styles.message} role="alert">
          Could not read the tracks: {play.error.message}
        </p>
      )}
    </div>
  )
}

type AlbumsSectionProps = { library: Library }

/** A music library's albums: searched and sorted, with Play and Shuffle. */
export const AlbumsSection = ({ library }: AlbumsSectionProps) => {
  const search = useAddressSearch()
  const [sort, setSort] = useState<MusicSort>(MUSIC_SORTS.artist)
  const albums = useQuery(albumsQuery({ libraryId: library.id, search: search.query, sort }))
  return (
    <div className={styles.section}>
      <AlbumsToolbar
        library={library}
        search={search}
        sort={sort}
        onSort={setSort}
        isPlayable={(albums.data?.length ?? 0) > 0}
      />
      {albums.isPending && <AlbumGridSkeleton />}
      {albums.error && (
        <p className={styles.message} role="alert">
          {albums.error.message}
        </p>
      )}
      {albums.data && albums.data.length === 0 && (
        <p className={styles.message}>
          {search.query
            ? `No album in ${library.name} matches "${search.query}".`
            : `No albums in ${library.name} yet. A scan files each audio file under its album as it reads its tags.`}
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
          aria-label="Search artists"
          placeholder="Search artists"
        />
      </div>
      {artists.error && (
        <p className={styles.message} role="alert">
          {artists.error.message}
        </p>
      )}
      {artists.data && artists.data.length === 0 && (
        <p className={styles.message}>No artists in {library.name} yet.</p>
      )}
      {artists.data && artists.data.length > 0 && (
        <ul className={styles.artists} aria-label="Artists">
          {artists.data.map((artist) => (
            <li key={artist.id} className={styles.artist}>
              <Link to={artistPath(artist.id)} className={styles.artistName}>
                {artist.name}
              </Link>
              <span className={styles.artistCount}>
                {artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
                {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
