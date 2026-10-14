import { useQuery } from '@tanstack/react-query'
import { type HomeShelf, type Library, matchTypeFor } from '@raven/core'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { ShowCard } from '@/components/ShowCard/ShowCard'
import { Bone, Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { homeQuery, librariesQuery } from '@/lib/queries'
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

/** A pinned library's newest arrivals, laid out as the library lays them out: posters, shows or frame grabs. */
const LibraryShelf = ({ shelf, library }: { shelf: HomeShelf; library: Library }) => {
  const { kind, ratingsSource } = library.settings
  const matchType = matchTypeFor(kind)
  const title = (
    <Link to={`/libraries/${library.id}`} className={styles.headingLink}>
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

/**
 * `/`: what is being watched, as posters (an episode wears its season's),
 * then a row for each pinned library with its eight newest arrivals, in the
 * side menu's order. Libraries still locked stay off it until the PIN opens
 * them.
 */
export const HomePage = () => {
  const id = useId()
  const home = useQuery(homeQuery)
  const libraries = useQuery(librariesQuery)
  const known = libraries.data ?? []
  const shelves = (home.data?.shelves ?? []).flatMap((shelf) => {
    const library = known.find((entry) => entry.id === shelf.libraryId)
    return library ? [{ shelf, library }] : []
  })
  const inProgress = home.data?.inProgress ?? []
  const isBare = home.isSuccess && inProgress.length === 0 && home.data.shelves.length === 0

  return (
    <section className={styles.page} aria-labelledby={id}>
      <h1 id={id} className={styles.title}>
        Home
      </h1>

      {home.isError && (
        <p className={styles.message} role="alert">
          {home.error.message}
        </p>
      )}
      {home.isPending && (
        <Loading label="Gathering your libraries">
          {['continue', 'newest'].map((shelf) => (
            <section key={shelf} className={styles.shelf}>
              <Bone shape="heading" width="short" />
              <ul className={styles.row}>
                <SkeletonCards picture="poster" count={8} />
              </ul>
            </section>
          ))}
        </Loading>
      )}
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
    </section>
  )
}
