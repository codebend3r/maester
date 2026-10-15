import { useQuery } from '@tanstack/react-query'
import { type HomeShelf, type Library, matchTypeFor } from '@raven/core'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SearchField } from '@/components/SearchField/SearchField'
import { ShowCard } from '@/components/ShowCard/ShowCard'
import { Bone, Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { homeQuery, homeSearchQuery, librariesQuery } from '@/lib/queries'
import { useAddressSearch } from '@/lib/useSearch'
import styles from '@/pages/HomePage/HomePage.module.scss'

/** A titled row of cards, or a line saying it has none yet. */
const Shelf = ({
  title,
  isEmpty,
  children,
}: {
  title: ReactNode
  isEmpty: boolean
  /** The cards, each its own `li`. */
  children: ReactNode
}) => {
  const id = useId()
  return (
    <section className={styles.shelf} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {isEmpty ? (
        <p className={styles.message}>Nothing here yet.</p>
      ) : (
        <ul className={styles.row}>{children}</ul>
      )}
    </section>
  )
}

/**
 * A library's row, laid out as the library lays it out: posters, shows or
 * frame grabs. Its heading opens the library, on `query` when the row is
 * what a search found, so the library lists every match.
 */
const LibraryShelf = ({
  shelf,
  library,
  query = '',
}: {
  shelf: HomeShelf
  library: Library
  query?: string
}) => {
  const { kind, ratingsSource } = library.settings
  const matchType = matchTypeFor(kind)
  const to = query
    ? `/libraries/${library.id}?${new URLSearchParams({ q: query })}`
    : `/libraries/${library.id}`
  const title = (
    <Link to={to} className={styles.headingLink}>
      {library.name}
    </Link>
  )
  switch (shelf.type) {
    case 'shows':
      return (
        <Shelf title={title} isEmpty={shelf.shows.length === 0}>
          {shelf.shows.map((entry) => (
            <ShowCard
              key={entry.show.id}
              entry={entry}
              ratingsSource={ratingsSource}
              sizes={POSTER_SIZES.row}
            />
          ))}
        </Shelf>
      )
    case 'media':
      return (
        <Shelf title={title} isEmpty={shelf.media.length === 0}>
          {shelf.media.map((media) =>
            matchType === 'movie' ? (
              <PosterCard
                key={media.id}
                media={media}
                matchType={matchType}
                ratingsSource={ratingsSource}
                sizes={POSTER_SIZES.row}
              />
            ) : (
              <MediaCard key={media.id} media={media} matchType={matchType} />
            ),
          )}
        </Shelf>
      )
    default: {
      const unknown: never = shelf
      return unknown
    }
  }
}

/** Each row with the library it is for; a row for a library not in the list is left out. */
const withLibraries = ({
  shelves,
  libraries,
}: {
  shelves: HomeShelf[]
  libraries: Library[]
}): Array<{ shelf: HomeShelf; library: Library }> =>
  shelves.flatMap((shelf) => {
    const library = libraries.find((entry) => entry.id === shelf.libraryId)
    return library ? [{ shelf, library }] : []
  })

/** Rows of cards standing in while they are read. */
const SkeletonShelves = ({ label, count }: { label: string; count: number }) => (
  <Loading label={label}>
    {Array.from({ length: count }, (_, index) => (
      <section key={index} className={styles.shelf}>
        <Bone shape="heading" width="short" />
        <ul className={styles.row}>
          <SkeletonCards picture="poster" count={8} />
        </ul>
      </section>
    ))}
  </Loading>
)

/** What a search from home found: a row for each library holding a match, in the side menu's order. */
const SearchResults = ({ query, libraries }: { query: string; libraries: Library[] }) => {
  const results = useQuery(homeSearchQuery(query))
  const shelves = withLibraries({ shelves: results.data ?? [], libraries })
  return (
    <section
      className={styles.results}
      aria-label={`Search results for ${query}`}
      aria-busy={results.isFetching}
    >
      {results.isError && (
        <p className={styles.message} role="alert">
          {results.error.message}
        </p>
      )}
      {results.isPending && <SkeletonShelves label="Searching every library" count={1} />}
      {results.isSuccess && shelves.length === 0 && (
        <p className={styles.message}>{`Nothing in any library matches "${query}".`}</p>
      )}
      {shelves.map(({ shelf, library }) => (
        <LibraryShelf key={library.id} shelf={shelf} library={library} query={query} />
      ))}
    </section>
  )
}

/** What is being watched, then each pinned library's newest arrivals. */
const Shelves = ({ libraries }: { libraries: Library[] }) => {
  const home = useQuery(homeQuery)
  const shelves = withLibraries({ shelves: home.data?.shelves ?? [], libraries })
  const inProgress = home.data?.inProgress ?? []
  const isBare = home.isSuccess && inProgress.length === 0 && home.data.shelves.length === 0

  return (
    <>
      {home.isError && (
        <p className={styles.message} role="alert">
          {home.error.message}
        </p>
      )}
      {home.isPending && <SkeletonShelves label="Gathering your libraries" count={2} />}
      {isBare && (
        <p className={styles.message}>
          Nothing to show yet. Pin a library in its settings and its newest videos show here, and
          whatever you start watching waits at the top.
        </p>
      )}

      {inProgress.length > 0 && (
        <Shelf title="Continue watching" isEmpty={false}>
          {inProgress.map(({ media, poster }) => (
            <PosterCard key={media.id} media={media} poster={poster} sizes={POSTER_SIZES.row} />
          ))}
        </Shelf>
      )}
      {shelves.map(({ shelf, library }) => (
        <LibraryShelf key={library.id} shelf={shelf} library={library} />
      ))}
    </>
  )
}

/**
 * `/`: a search through every library, then what is being watched, as
 * posters (an episode wears its season's), then a row for each pinned
 * library with its eight newest arrivals, in the side menu's order. A
 * search, which rides in the address as `?q=`, shows what it found in place
 * of the rows. Libraries still locked stay off it until the PIN opens them.
 */
export const HomePage = () => {
  const ids = { title: useId(), search: useId() }
  const search = useAddressSearch()
  const libraries = useQuery(librariesQuery)
  const known = libraries.data ?? []

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <header className={styles.header}>
        <h1 id={ids.title} className={styles.title}>
          Home
        </h1>
        <search className={styles.search}>
          <label htmlFor={ids.search} className="visually-hidden">
            Search every library
          </label>
          <SearchField
            id={ids.search}
            search={search}
            className={styles.input}
            placeholder="Search every library"
          />
        </search>
      </header>

      {search.query ? (
        <SearchResults query={search.query} libraries={known} />
      ) : (
        <Shelves libraries={known} />
      )}
    </section>
  )
}
