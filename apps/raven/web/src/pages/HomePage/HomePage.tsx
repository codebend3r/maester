import { useQuery } from '@tanstack/react-query'
import {
  HOME_SHELF_TYPES,
  type HomeShelf,
  ITEM_TYPES,
  type Library,
  matchTypeFor,
  withLibraries,
} from '@raven/core'
import { type ReactNode, useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BackButton } from '@/components/BackButton/BackButton'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { ShowCard } from '@/components/ShowCard/ShowCard'
import { Bone, Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { heroQuery, homeQuery, homeSearchQuery, librariesQuery } from '@/lib/queries'
import { ContinueWatching } from '@/pages/HomePage/ContinueWatching'
import { HomeHero } from '@/pages/HomePage/HomeHero'
import { featuredOf } from '@/pages/HomePage/featured'
import styles from '@/pages/HomePage/HomePage.module.scss'

/** A row of cards under its ruled heading, or a line saying it has none yet. */
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
      <SectionHeading id={id}>{title}</SectionHeading>
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
    case HOME_SHELF_TYPES.shows:
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
    case HOME_SHELF_TYPES.media:
      return (
        <Shelf title={title} isEmpty={shelf.media.length === 0}>
          {shelf.media.map((media) =>
            matchType === ITEM_TYPES.movie ? (
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

/** The hero's shape, standing in while its titles are read. */
const HeroSkeleton = () => (
  <Loading label="Gathering the newest titles">
    <div className={styles.skeletonHero}>
      <div className={styles.skeletonWords}>
        <Bone shape="small" width="short" />
        <Bone shape="hero" width="most" />
        <Bone shape="text" width="most" />
        <Bone shape="text" width="half" />
        <Bone shape="button" />
      </div>
      <div className={styles.skeletonPoster}>
        <Bone shape="poster" />
      </div>
    </div>
  </Loading>
)

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
      className={styles.sections}
      aria-label={`Search results for ${query}`}
      aria-busy={results.isFetching}
    >
      {results.isError && (
        <p className={styles.message} role="alert">
          {results.error.message}
        </p>
      )}
      {results.isPending && <SkeletonShelves label="Searching every library" count={1} />}
      {/* The last search's answer stands in while this one is read: it says nothing of this one. */}
      {results.isSuccess && !results.isPlaceholderData && shelves.length === 0 && (
        <p className={styles.message}>{`Nothing in any library matches "${query}".`}</p>
      )}
      {shelves.map(({ shelf, library }) => (
        <LibraryShelf key={library.id} shelf={shelf} library={library} query={query} />
      ))}
    </section>
  )
}

/** The hero's titles in turn, then what is being watched, then each pinned library's newest. */
const Shelves = ({
  libraries,
  areLibrariesPending,
}: {
  libraries: Library[]
  areLibrariesPending: boolean
}) => {
  const home = useQuery(homeQuery)
  const hero = useQuery(heroQuery)
  const shelves = withLibraries({ shelves: home.data?.shelves ?? [], libraries })
  const featured = featuredOf({ hero: hero.data ?? [], libraries })
  const inProgress = home.data?.inProgress ?? []
  const isBare = home.isSuccess && inProgress.length === 0 && home.data.shelves.length === 0

  return (
    <div className={styles.sections}>
      {home.isError && (
        <p className={styles.message} role="alert">
          {home.error.message}
        </p>
      )}
      {(hero.isPending || areLibrariesPending) && <HeroSkeleton />}
      {home.isPending && <SkeletonShelves label="Gathering your libraries" count={2} />}
      {isBare && (
        <p className={styles.message}>
          Nothing to show yet. Pin a library in its settings and its newest videos show here, and
          whatever you start watching waits at the top.
        </p>
      )}

      {featured.length > 0 && <HomeHero featured={featured} />}
      {inProgress.length > 0 && <ContinueWatching entries={inProgress} />}
      {shelves.map(({ shelf, library }) => (
        <LibraryShelf key={library.id} shelf={shelf} library={library} />
      ))}
    </div>
  )
}

/**
 * `/`: the hero's titles, picked by the admin or the newest releases, taking turns, then what
 * is being watched, as wide tiles, then a row for each pinned library with
 * its eight newest arrivals, in the side menu's order. A search from the
 * shell's bar, which rides in the address as `?q=`, shows what it found in
 * place of all of it. Libraries still locked stay off it until the PIN
 * opens them.
 */
export const HomePage = () => {
  const titleId = useId()
  const [address] = useSearchParams()
  const query = (address.get('q') ?? '').trim()
  const libraries = useQuery(librariesQuery)
  const known = libraries.data ?? []

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={null} className={styles.back} />
        <h1 id={titleId} className={styles.title}>
          Home
        </h1>
      </header>

      {query ? (
        <SearchResults query={query} libraries={known} />
      ) : (
        <Shelves libraries={known} areLibrariesPending={libraries.isPending} />
      )}
    </section>
  )
}
