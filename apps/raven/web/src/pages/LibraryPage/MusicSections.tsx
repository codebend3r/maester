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
import { Link, useNavigate } from 'react-router-dom'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog/PlaylistNameDialog'
import { SearchField } from '@/components/SearchField/SearchField'
import { libraryTracks, playlistFacts, playlistPath } from '@/lib/music'
import { albumsQuery, artistsQuery, playlistsQuery } from '@/lib/queries'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
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
        <ArtistList artists={artists.data} label="Artists" />
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
          New playlist
        </Button>
      </div>
      {playlists.error && (
        <p className={styles.message} role="alert">
          {playlists.error.message}
        </p>
      )}
      {playlists.data && playlists.data.length === 0 && (
        <p className={styles.message}>
          No playlists yet. Make one here, or add tracks to a new one from an album.
        </p>
      )}
      {playlists.data && playlists.data.length > 0 && (
        <ul className={styles.playlists} aria-label="Playlists">
          {playlists.data.map((playlist) => (
            <li key={playlist.id} className={styles.playlist}>
              <Link to={playlistPath(playlist.id)} className={styles.playlistName}>
                {playlist.name}
              </Link>
              <span className={styles.playlistFacts}>
                {playlistFacts({ playlist }).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {isNaming && (
        <PlaylistNameDialog
          title="New playlist"
          initialName=""
          submitLabel="Make playlist"
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
