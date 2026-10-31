import { type ComponentType, useId } from 'react'
import { Link } from 'react-router-dom'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { useIsCurrent } from '@/components/AppShell/currentPage'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { ListState } from '@/components/ListState/ListState'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { MUSIC_COPY } from '@/lib/copy'
import { MUSIC_PATHS } from '@/lib/music'
import { type MusicListing, useAllAlbums, useAllArtists, useAllSongs } from '@/lib/useMusicListings'
import { PlaylistsSection } from '@/components/PlaylistsSection/PlaylistsSection'
import { SongList } from '@/pages/MusicLibraryPage/SongList'
import { MUSIC_LIBRARY_COPY } from '@/pages/MusicLibraryPage/copy'
import styles from '@/pages/MusicLibraryPage/MusicLibraryPage.module.scss'

/** The library's four lists, each at its own address. */
export const MUSIC_LIBRARY_SECTIONS = {
  albums: 'albums',
  artists: 'artists',
  songs: 'songs',
  playlists: 'playlists',
} as const

type MusicLibrarySection = (typeof MUSIC_LIBRARY_SECTIONS)[keyof typeof MUSIC_LIBRARY_SECTIONS]

const SECTION_LINKS = [
  {
    section: MUSIC_LIBRARY_SECTIONS.albums,
    to: MUSIC_PATHS.albums,
    label: MUSIC_LIBRARY_COPY.albums,
  },
  {
    section: MUSIC_LIBRARY_SECTIONS.artists,
    to: MUSIC_PATHS.artists,
    label: MUSIC_LIBRARY_COPY.artists,
  },
  { section: MUSIC_LIBRARY_SECTIONS.songs, to: MUSIC_PATHS.songs, label: MUSIC_LIBRARY_COPY.songs },
  {
    section: MUSIC_LIBRARY_SECTIONS.playlists,
    to: MUSIC_PATHS.playlists,
    label: MUSIC_LIBRARY_COPY.playlists,
  },
] as const satisfies readonly { section: MusicLibrarySection; to: string; label: string }[]

type SectionLinkProps = { to: string; label: string }

const SectionLink = ({ to, label }: SectionLinkProps) => {
  const isCurrent = useIsCurrent([to])
  return (
    <Link to={to} className={styles.sectionLink} aria-current={isCurrent ? 'page' : undefined}>
      {label}
    </Link>
  )
}

type EmptyOfProps<T> = { listing: MusicListing<T>; empty: string }

/** What an empty list says: that raven holds no music, or the list's own line. */
const emptyOf = <T,>({ listing, empty }: EmptyOfProps<T>): string =>
  listing.hasNoMusic ? MUSIC_COPY.noMusic : empty

/** Every music library's albums, by title. */
const AlbumsList = () => {
  const albums = useAllAlbums({ search: '' })
  return (
    <ListState
      entries={albums.isRead ? albums.entries : undefined}
      error={albums.error}
      empty={emptyOf({ listing: albums, empty: MUSIC_LIBRARY_COPY.noAlbums })}
      loading={<AlbumGridSkeleton />}
    >
      {(entries) => <AlbumGrid albums={entries} />}
    </ListState>
  )
}

/** Every music library's artists, each once, by name. */
const ArtistsList = () => {
  const artists = useAllArtists({ search: '' })
  return (
    <ListState
      entries={artists.isRead ? artists.entries : undefined}
      error={artists.error}
      empty={emptyOf({ listing: artists, empty: MUSIC_LIBRARY_COPY.noArtists })}
    >
      {(entries) => <ArtistList artists={entries} label={MUSIC_LIBRARY_COPY.artists} />}
    </ListState>
  )
}

/** Every music library's tracks, by title, a page at a time. */
const SongsList = () => {
  const songs = useAllSongs({ search: '' })
  return (
    <ListState
      entries={songs.isRead ? songs.entries : undefined}
      error={songs.error}
      empty={emptyOf({ listing: songs, empty: MUSIC_LIBRARY_COPY.noSongs })}
    >
      {(tracks) => (
        <SongList
          tracks={tracks}
          label={MUSIC_LIBRARY_COPY.songs}
          hasMore={songs.hasMore}
          isLoadingMore={songs.isLoadingMore}
          onMore={songs.loadMore}
        />
      )}
    </ListState>
  )
}

const SECTION_VIEWS = {
  [MUSIC_LIBRARY_SECTIONS.albums]: AlbumsList,
  [MUSIC_LIBRARY_SECTIONS.artists]: ArtistsList,
  [MUSIC_LIBRARY_SECTIONS.songs]: SongsList,
  [MUSIC_LIBRARY_SECTIONS.playlists]: PlaylistsSection,
} as const satisfies Record<MusicLibrarySection, ComponentType>

type MusicLibraryPageProps = { section: MusicLibrarySection }

/**
 * `/music/albums`, `/artists`, `/songs` and `/playlists`: the albums,
 * artists, songs and playlists across every music library, one list at a
 * time under links to the four.
 */
export const MusicLibraryPage = ({ section }: MusicLibraryPageProps) => {
  const titleId = useId()
  const Section = SECTION_VIEWS[section]
  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <PageTitle id={titleId} icon="libraries" className={styles.title}>
        {MUSIC_LIBRARY_COPY.title}
      </PageTitle>
      <nav className={styles.sections} aria-label={MUSIC_LIBRARY_COPY.lists}>
        {SECTION_LINKS.map((link) => (
          <SectionLink key={link.section} to={link.to} label={link.label} />
        ))}
      </nav>
      <div className={styles.list}>
        <Section />
      </div>
    </article>
  )
}
