import { useQuery } from '@tanstack/react-query'
import {
  HOME_SHELF_TYPES,
  type HomeShelf,
  ITEM_TYPES,
  type Library,
  type MediaItem,
  matchTypeFor,
  withLibraries,
} from '@raven/core'
import { type ComponentType, type ReactNode, useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { BackButton } from '@/components/BackButton/BackButton'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { ShowCard } from '@/components/ShowCard/ShowCard'
import { Bone, Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { heroQuery, homeQuery, homeSearchQuery, librariesQuery } from '@/lib/queries'
import { ContinueWatching } from '@/pages/HomePage/ContinueWatching'
import { HOME_COPY } from '@/pages/HomePage/copy'
import { HomeHero } from '@/pages/HomePage/HomeHero'
import { featuredOf } from '@/pages/HomePage/featured'
import styles from '@/pages/HomePage/HomePage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'
import { BingeSection } from '@/pages/BingePage/BingePage'
import { useIsDesktop } from '@/stores/desktop'

const SHELF_STATES = { empty: 'empty', filled: 'filled' } as const
type ShelfState = (typeof SHELF_STATES)[keyof typeof SHELF_STATES]

type ShelfBodyProps = { children: ReactNode }

const EmptyShelf = () => <p className={styles.message}>{HOME_COPY.emptyShelf}</p>

type FilledShelfProps = ShelfBodyProps

const FilledShelf = ({ children }: FilledShelfProps) => <ul className={styles.row}>{children}</ul>

const SHELF_BODIES = {
  [SHELF_STATES.empty]: EmptyShelf,
  [SHELF_STATES.filled]: FilledShelf,
} as const satisfies Record<ShelfState, ComponentType<ShelfBodyProps>>

type ShelfProps = {
  title: ReactNode
  isEmpty: boolean
  /** The cards, each its own `li`. */
  children: ReactNode
}

/** A row of cards under its ruled heading, or a line saying it has none yet. */
const Shelf = ({ title, isEmpty, children }: ShelfProps) => {
  const id = useId()
  const Body = SHELF_BODIES[isEmpty ? SHELF_STATES.empty : SHELF_STATES.filled]
  return (
    <section className={styles.shelf} aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      <Body>{children}</Body>
    </section>
  )
}

const CARD_KINDS = { poster: 'poster', frame: 'frame' } as const
type CardKind = (typeof CARD_KINDS)[keyof typeof CARD_KINDS]

type ShelfCardProps = {
  media: MediaItem
  matchType: ReturnType<typeof matchTypeFor>
  ratingsSource: Library['settings']['ratingsSource']
}

type PosterShelfCardProps = ShelfCardProps

const PosterShelfCard = ({ media, matchType, ratingsSource }: PosterShelfCardProps) => (
  <PosterCard
    media={media}
    matchType={matchType}
    ratingsSource={ratingsSource}
    sizes={POSTER_SIZES.row}
  />
)

type FrameShelfCardProps = ShelfCardProps

const FrameShelfCard = ({ media, matchType }: FrameShelfCardProps) => (
  <MediaCard media={media} matchType={matchType} />
)

const SHELF_CARDS = {
  [CARD_KINDS.poster]: PosterShelfCard,
  [CARD_KINDS.frame]: FrameShelfCard,
} as const satisfies Record<CardKind, ComponentType<ShelfCardProps>>

type ShelfContentProps = {
  title: ReactNode
  ratingsSource: Library['settings']['ratingsSource']
  matchType: ReturnType<typeof matchTypeFor>
}

type ShowsShelfProps = ShelfContentProps & {
  shelf: Extract<HomeShelf, { type: typeof HOME_SHELF_TYPES.shows }>
}

const ShowsShelf = ({ title, ratingsSource, shelf }: ShowsShelfProps) => (
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

type MediaShelfProps = ShelfContentProps & {
  shelf: Extract<HomeShelf, { type: typeof HOME_SHELF_TYPES.media }>
}

const MediaShelf = ({ title, ratingsSource, matchType, shelf }: MediaShelfProps) => {
  const Card = SHELF_CARDS[matchType === ITEM_TYPES.movie ? CARD_KINDS.poster : CARD_KINDS.frame]
  return (
    <Shelf title={title} isEmpty={shelf.media.length === 0}>
      {shelf.media.map((media) => (
        <Card key={media.id} media={media} matchType={matchType} ratingsSource={ratingsSource} />
      ))}
    </Shelf>
  )
}

type LibraryShelfViewProps = {
  [HOME_SHELF_TYPES.shows]: ShowsShelfProps
  [HOME_SHELF_TYPES.media]: MediaShelfProps
}

const LIBRARY_SHELVES = {
  [HOME_SHELF_TYPES.shows]: ShowsShelf,
  [HOME_SHELF_TYPES.media]: MediaShelf,
} as const satisfies ViewsOf<LibraryShelfViewProps>

type LibraryShelfViewOfProps = ShelfContentProps & { shelf: HomeShelf }

/** The row's view for its type of shelf. */
const libraryShelfViewOf = ({
  shelf,
  ...content
}: LibraryShelfViewOfProps): ViewOf<LibraryShelfViewProps> => {
  switch (shelf.type) {
    case HOME_SHELF_TYPES.shows:
      return { key: HOME_SHELF_TYPES.shows, props: { ...content, shelf } }
    case HOME_SHELF_TYPES.media:
      return { key: HOME_SHELF_TYPES.media, props: { ...content, shelf } }
    default: {
      const unknown: never = shelf
      return unknown
    }
  }
}

type LibraryShelfProps = {
  shelf: HomeShelf
  library: Library
  query?: string
}

/**
 * A library's row, laid out as the library lays it out: posters, shows or
 * frame grabs. Its heading opens the library, on `query` when the row is
 * what a search found, so the library lists every match.
 */
const LibraryShelf = ({ shelf, library, query = '' }: LibraryShelfProps) => {
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
  return (
    <KeyedView<LibraryShelfViewProps>
      views={LIBRARY_SHELVES}
      view={libraryShelfViewOf({ shelf, title, ratingsSource, matchType })}
    />
  )
}

/** The hero's shape, standing in while its titles are read. */
const HeroSkeleton = () => (
  <Loading label={HOME_COPY.gatheringHero}>
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

type SkeletonShelvesProps = { label: string; count: number }

/** Rows of cards standing in while they are read. */
const SkeletonShelves = ({ label, count }: SkeletonShelvesProps) => (
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

const HOME_VIEWS = { search: 'search', shelves: 'shelves' } as const
type HomeView = (typeof HOME_VIEWS)[keyof typeof HOME_VIEWS]

type HomeBodyProps = {
  query: string
  libraries: Library[]
  areLibrariesPending: boolean
}

type SearchResultsProps = HomeBodyProps

/** What a search from home found: a row for each library holding a match, in the side menu's order. */
const SearchResults = ({ query, libraries }: SearchResultsProps) => {
  const results = useQuery(homeSearchQuery(query))
  const shelves = withLibraries({ shelves: results.data ?? [], libraries })
  return (
    <section
      className={styles.sections}
      aria-label={HOME_COPY.searchResultsFor(query)}
      aria-busy={results.isFetching}
    >
      {results.isError && (
        <p className={styles.message} role="alert">
          {results.error.message}
        </p>
      )}
      {results.isPending && <SkeletonShelves label={HOME_COPY.searching} count={1} />}
      {/* The last search's answer stands in while this one is read: it says nothing of this one. */}
      {results.isSuccess && !results.isPlaceholderData && shelves.length === 0 && (
        <p className={styles.message}>{HOME_COPY.noMatches(query)}</p>
      )}
      {shelves.map(({ shelf, library }) => (
        <LibraryShelf key={library.id} shelf={shelf} library={library} query={query} />
      ))}
    </section>
  )
}

type ShelvesProps = HomeBodyProps

/** The hero's titles in turn, then what is being watched, then each pinned library's newest. */
const Shelves = ({ libraries, areLibrariesPending }: ShelvesProps) => {
  const isDesktop = useIsDesktop()
  const home = useQuery(homeQuery)
  const hero = useQuery(heroQuery)
  const shelves = withLibraries({ shelves: home.data?.shelves ?? [], libraries })
  const featured = featuredOf({ hero: hero.data ?? [], libraries })
  const inProgress = home.data?.inProgress ?? []
  const isBare = home.isSuccess && inProgress.length === 0 && home.data.shelves.length === 0

  return (
    <div className={styles.sections}>
      {!isDesktop && <BingeSection isHome />}
      {home.isError && (
        <p className={styles.message} role="alert">
          {home.error.message}
        </p>
      )}
      {(hero.isPending || areLibrariesPending) && <HeroSkeleton />}
      {home.isPending && <SkeletonShelves label={HOME_COPY.gatheringLibraries} count={2} />}
      {isBare && <p className={styles.message}>{HOME_COPY.bare}</p>}

      {featured.length > 0 && <HomeHero featured={featured} />}
      {inProgress.length > 0 && <ContinueWatching entries={inProgress} />}
      {shelves.map(({ shelf, library }) => (
        <LibraryShelf key={library.id} shelf={shelf} library={library} />
      ))}
    </div>
  )
}

const HOME_BODIES = {
  [HOME_VIEWS.search]: SearchResults,
  [HOME_VIEWS.shelves]: Shelves,
} as const satisfies Record<HomeView, ComponentType<HomeBodyProps>>

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
  const Body = HOME_BODIES[query ? HOME_VIEWS.search : HOME_VIEWS.shelves]

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={null} className={styles.back} />
        <PageTitle id={titleId} icon="home" className={styles.title}>
          {COMMON_COPY.home}
        </PageTitle>
      </header>

      <Body query={query} libraries={known} areLibrariesPending={libraries.isPending} />
    </section>
  )
}
