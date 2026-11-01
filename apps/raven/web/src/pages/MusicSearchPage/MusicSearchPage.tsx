import { type ReactNode, useId } from 'react'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { ListState } from '@/components/ListState/ListState'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { SearchField } from '@/components/SearchField/SearchField'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { useAllAlbums, useAllArtists, useAllSongs } from '@/lib/useMusicListings'
import { useAddressSearch } from '@/lib/useSearch'
import { SongList } from '@/pages/MusicLibraryPage/SongList'
import { MUSIC_SEARCH_COPY } from '@/pages/MusicSearchPage/copy'
import styles from '@/pages/MusicSearchPage/MusicSearchPage.module.scss'

type ResultsProps = { title: string; children: ReactNode }

const Results = ({ title, children }: ResultsProps) => {
  const id = useId()
  return (
    <section className={styles.results} aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  )
}

type MatchesProps = { query: string }

/** What matches `query` in every music library: its albums, its artists, then its songs. */
const Matches = ({ query }: MatchesProps) => {
  const albums = useAllAlbums({ search: query })
  const artists = useAllArtists({ search: query })
  const songs = useAllSongs({ search: query })
  return (
    <>
      <Results title={MUSIC_SEARCH_COPY.albums}>
        <ListState
          entries={albums.isRead ? albums.entries : undefined}
          error={albums.error}
          empty={MUSIC_SEARCH_COPY.noAlbums(query)}
        >
          {(entries) => <AlbumGrid albums={entries} />}
        </ListState>
      </Results>
      <Results title={MUSIC_SEARCH_COPY.artists}>
        <ListState
          entries={artists.isRead ? artists.entries : undefined}
          error={artists.error}
          empty={MUSIC_SEARCH_COPY.noArtists(query)}
        >
          {(entries) => <ArtistList artists={entries} label={MUSIC_SEARCH_COPY.artists} />}
        </ListState>
      </Results>
      <Results title={MUSIC_SEARCH_COPY.songs}>
        <ListState
          entries={songs.isRead ? songs.entries : undefined}
          error={songs.error}
          empty={MUSIC_SEARCH_COPY.noSongs(query)}
        >
          {(tracks) => (
            <SongList
              tracks={tracks}
              label={MUSIC_SEARCH_COPY.songs}
              hasMore={songs.hasMore}
              isLoadingMore={songs.isLoadingMore}
              onMore={songs.loadMore}
            />
          )}
        </ListState>
      </Results>
    </>
  )
}

/**
 * `/music/search`: the music alone, unlike the bar's search through every
 * library. The query rides in the address as `?q=`, and what matches it is
 * listed by albums, artists and songs across every music library.
 */
export const MusicSearchPage = () => {
  const titleId = useId()
  const search = useAddressSearch()
  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <PageTitle id={titleId} icon="search" className={styles.title}>
        {MUSIC_SEARCH_COPY.title}
      </PageTitle>
      <SearchField
        search={search}
        className={styles.field}
        aria-label={MUSIC_SEARCH_COPY.searchMusic}
        placeholder={MUSIC_SEARCH_COPY.placeholder}
      />
      {search.query === '' && <p className={styles.hint}>{MUSIC_SEARCH_COPY.hint}</p>}
      {search.query !== '' && <Matches query={search.query} />}
    </article>
  )
}
