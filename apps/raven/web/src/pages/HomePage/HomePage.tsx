import { useQuery } from '@tanstack/react-query'
import {
  type AlbumShelf,
  HOME_SHELF_TYPES,
  type HomeShelf,
  ITEM_TYPES,
  type Library,
  type MediaItem,
  RATING_SOURCES,
  SHELF_ORDER_COPY,
  SHELF_TOGGLE_COPY,
  matchTypeFor,
  pinnedShelvesOf,
  shelfOrderOf,
  shelvesInOrder,
  withLibraries,
  libraryPath,
} from '@raven/core'
import { type ComponentType, type ReactNode, useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BUTTON_TONES, Button, Icon, SHELF_ORDER_ICONS } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf, useReleasedShelves } from '@raven/ui/headless'
import { AlbumCard } from '@/components/AlbumGrid/AlbumGrid'
import { BackButton } from '@/components/BackButton/BackButton'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { ShowCard } from '@/components/ShowCard/ShowCard'
import { usePinnedHere } from '@/lib/pins'
import { POSTER_SIZES } from '@/lib/posters'
import {
  heroQuery,
  homeAlbumsQuery,
  homeQuery,
  homeSearchQuery,
  librariesQuery,
  ravenQueries,
} from '@/lib/queries'
import { useShelfOrders } from '@/stores/shelfOrders'
import { ContinueWatching } from '@/pages/HomePage/ContinueWatching'
import { HOME_COPY } from '@/pages/HomePage/copy'
import { HomeHero } from '@/pages/HomePage/HomeHero'
import { HeroSkeleton, SearchSkeleton, ShelvesSkeleton } from '@/pages/HomePage/HomeSkeleton'
import { featuredOf } from '@/pages/HomePage/featured'
import styles from '@/pages/HomePage/HomePage.module.scss'
import frames from '@/pages/HomePage/HomeFrames.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'
import { HomeBinge } from '@/pages/BingePage/BingePage'
import { PAGE_PARAMS, librarySearchPath } from '@/lib/appPaths'
import { CARD_PICTURES, type CardPicture } from '@/lib/cardPictures'

// Every Home shelf scores alike, whatever each library shows on its own page; `pickScore` falls back to TMDB.
const HOME_RATINGS_SOURCE = RATING_SOURCES.metacritic

const SHELF_STATES = { empty: 'empty', filled: 'filled' } as const
type ShelfState = (typeof SHELF_STATES)[keyof typeof SHELF_STATES]

type ShelfBodyProps = { children: ReactNode }

const EmptyShelf = () => <p className={styles.message}>{HOME_COPY.emptyShelf}</p>

type FilledShelfProps = ShelfBodyProps

const FilledShelf = ({ children }: FilledShelfProps) => <ul className={frames.row}>{children}</ul>

const SHELF_BODIES = {
  [SHELF_STATES.empty]: EmptyShelf,
  [SHELF_STATES.filled]: FilledShelf,
} as const satisfies Record<ShelfState, ComponentType<ShelfBodyProps>>

type ShelfProps = {
  title: ReactNode
  /** What sits at the heading's right: a library shelf's order toggle on Home. */
  aside?: ReactNode
  isEmpty: boolean
  /** The cards, each its own `li`. */
  children: ReactNode
}

/** A row of cards under its ruled heading, or a line saying it has none yet. */
const Shelf = ({ title, aside, isEmpty, children }: ShelfProps) => {
  const id = useId()
  const Body = SHELF_BODIES[isEmpty ? SHELF_STATES.empty : SHELF_STATES.filled]
  return (
    <section className={frames.section} aria-labelledby={id}>
      <SectionHeading id={id} aside={aside}>
        {title}
      </SectionHeading>
      <Body>{children}</Body>
    </section>
  )
}

type ShelfCardProps = {
  media: MediaItem
  matchType: ReturnType<typeof matchTypeFor>
}

type PosterShelfCardProps = ShelfCardProps

const PosterShelfCard = ({ media, matchType }: PosterShelfCardProps) => (
  <PosterCard
    media={media}
    matchType={matchType}
    sizes={POSTER_SIZES.row}
    ratingsSource={HOME_RATINGS_SOURCE}
  />
)

type FrameShelfCardProps = ShelfCardProps

const FrameShelfCard = ({ media, matchType }: FrameShelfCardProps) => (
  <MediaCard media={media} matchType={matchType} ratingsSource={HOME_RATINGS_SOURCE} />
)

const SHELF_CARDS = {
  [CARD_PICTURES.poster]: PosterShelfCard,
  [CARD_PICTURES.frame]: FrameShelfCard,
} as const satisfies Record<CardPicture, ComponentType<ShelfCardProps>>

type ShelfContentProps = {
  title: ReactNode
  aside: ReactNode
  matchType: ReturnType<typeof matchTypeFor>
}

type ShowsShelfProps = ShelfContentProps & {
  shelf: Extract<HomeShelf, { type: typeof HOME_SHELF_TYPES.shows }>
}

const ShowsShelf = ({ title, aside, shelf }: ShowsShelfProps) => (
  <Shelf title={title} aside={aside} isEmpty={shelf.shows.length === 0}>
    {shelf.shows.map((entry) => (
      <ShowCard
        key={entry.show.id}
        entry={entry}
        ratingsSource={HOME_RATINGS_SOURCE}
        sizes={POSTER_SIZES.row}
      />
    ))}
  </Shelf>
)

type MediaShelfProps = ShelfContentProps & {
  shelf: Extract<HomeShelf, { type: typeof HOME_SHELF_TYPES.media }>
}

const MediaShelf = ({ title, aside, matchType, shelf }: MediaShelfProps) => {
  const Card =
    SHELF_CARDS[matchType === ITEM_TYPES.movie ? CARD_PICTURES.poster : CARD_PICTURES.frame]
  return (
    <Shelf title={title} aside={aside} isEmpty={shelf.media.length === 0}>
      {shelf.media.map((media) => (
        <Card key={media.id} media={media} matchType={matchType} />
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

type ShelfHeadingLinkProps = { to: string; children: ReactNode }

/**
 * A shelf's heading as the way into its library: the whole line, the name at
 * the left and an arrow at the right, which a phone words as See all, as the
 * phone app does.
 */
const ShelfHeadingLink = ({ to, children }: ShelfHeadingLinkProps) => (
  <Link to={to} className={styles.headingLink}>
    <span className={styles.headingName}>{children}</span>
    <span className={styles.headingArrow}>
      <Icon name="next" size={24} />
    </span>
    <span className={styles.headingSeeAll} aria-hidden="true">
      {HOME_COPY.seeAllShelf}
    </span>
  </Link>
)

type LibraryShelfProps = {
  shelf: HomeShelf
  library: Library
  query?: string
  /** The order toggle at the heading's right, on Home's shelves; a search's rows have none. */
  aside?: ReactNode
}

/**
 * A library's row, laid out as the library lays it out: posters, shows or
 * frame grabs. Its heading opens the library, on `query` when the row is
 * what a search found, so the library lists every match.
 */
const LibraryShelf = ({ shelf, library, query = '', aside = null }: LibraryShelfProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  const to = librarySearchPath({ libraryId: library.id, query })
  const title = <ShelfHeadingLink to={to}>{library.name}</ShelfHeadingLink>
  return (
    <KeyedView<LibraryShelfViewProps>
      views={LIBRARY_SHELVES}
      view={libraryShelfViewOf({ shelf, title, aside, matchType })}
    />
  )
}

type AlbumsShelfProps = { shelf: AlbumShelf; library: Library; aside: ReactNode }

/** A music library's row: its newest arrivals or releases first, one cover each, the library's name opening it. */
const AlbumsShelf = ({ shelf, library, aside }: AlbumsShelfProps) => (
  <Shelf
    title={<ShelfHeadingLink to={libraryPath(library.id)}>{library.name}</ShelfHeadingLink>}
    aside={aside}
    isEmpty={shelf.albums.length === 0}
  >
    {shelf.albums.map((album) => (
      <AlbumCard key={album.id} album={album} />
    ))}
  </Shelf>
)

type ShelfOrderToggleProps = { library: Library }

/**
 * A library shelf's order on Home, Recently added or Newly released, as a button that turns it
 * to the other; the choice is kept on this browser.
 */
const ShelfOrderToggle = ({ library }: ShelfOrderToggleProps) => {
  const order = useShelfOrders(({ orders }) => shelfOrderOf({ orders, libraryId: library.id }))
  const turn = useShelfOrders((state) => state.turn)
  return (
    <Button
      tone={BUTTON_TONES.ghost}
      icon={SHELF_ORDER_ICONS[order]}
      aria-label={SHELF_TOGGLE_COPY.label({ name: library.name, order })}
      onClick={() => turn({ libraryId: library.id })}
    >
      {SHELF_ORDER_COPY[order]}
    </Button>
  )
}

type LibraryRowProps = { shelf: HomeShelf; library: Library; albumShelves: readonly AlbumShelf[] }

/** A library's row on Home: its albums when it is a music library, else its shelf laid out as its files are. */
const LibraryRow = ({ shelf, library, albumShelves }: LibraryRowProps) => {
  const albums = albumShelves.find(({ libraryId }) => libraryId === library.id)
  const toggle = <ShelfOrderToggle library={library} />
  return albums === undefined ? (
    <LibraryShelf shelf={shelf} library={library} aside={toggle} />
  ) : (
    <AlbumsShelf shelf={albums} library={library} aside={toggle} />
  )
}

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
      className={frames.sections}
      aria-label={HOME_COPY.searchResultsFor(query)}
      aria-busy={results.isFetching}
    >
      {results.isError && (
        <p className={styles.message} role="alert">
          {results.error.message}
        </p>
      )}
      {results.isPending && <SearchSkeleton />}
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

/**
 * The hero's titles in turn, then what is being watched, then each pinned library's newest
 * arrivals, or its newest releases where its shelf is turned to them.
 */
const Shelves = ({ libraries, areLibrariesPending }: ShelvesProps) => {
  const home = useQuery(homeQuery)
  const hero = useQuery(heroQuery)
  const albums = useQuery(homeAlbumsQuery)
  const orders = useShelfOrders((state) => state.orders)
  const released = useReleasedShelves({ queries: ravenQueries, orders })
  const pinnedHere = usePinnedHere()
  const shelves = withLibraries({
    shelves: shelvesInOrder({
      shelves: pinnedShelvesOf({ shelves: home.data?.shelves ?? [], pinnedHere }),
      released: released.shelves,
      orders,
    }),
    libraries,
  })
  const albumShelves = shelvesInOrder({
    shelves: albums.data ?? [],
    released: released.albums,
    orders,
  })
  const featured = featuredOf({ hero: hero.data ?? [], libraries })
  const inProgress = home.data?.inProgress ?? []
  const isBare = home.isSuccess && inProgress.length === 0 && home.data.shelves.length === 0

  return (
    <div className={frames.slots}>
      <div className={frames.slot1}>
        <HomeBinge />
      </div>
      <div className={frames.slot2}>
        {(hero.isPending || areLibrariesPending) && <HeroSkeleton />}
        {featured.length > 0 && <HomeHero featured={featured} />}
      </div>
      <div className={frames.slot3}>
        {home.isPending && <ShelvesSkeleton />}
        {inProgress.length > 0 && <ContinueWatching entries={inProgress} />}
      </div>
      <div className={frames.slot4}>
        {home.isError && (
          <p className={styles.message} role="alert">
            {home.error.message}
          </p>
        )}
        {isBare && <p className={styles.message}>{HOME_COPY.bare}</p>}
        {shelves.map(({ shelf, library }) => (
          <LibraryRow
            key={library.id}
            shelf={shelf}
            library={library}
            albumShelves={albumShelves}
          />
        ))}
      </div>
    </div>
  )
}

const HOME_BODIES = {
  [HOME_VIEWS.search]: SearchResults,
  [HOME_VIEWS.shelves]: Shelves,
} as const satisfies Record<HomeView, ComponentType<HomeBodyProps>>

/**
 * `/`: the hero's titles, picked by the admin or the newest releases, taking turns, then what
 * is being watched, as wide tiles, then a row for each library the account
 * pinned on this server (every library's while it pinned none here) with
 * its fifty newest arrivals, or its newest releases once its heading's toggle
 * turns it to them, each row scrolling on its own, in the side menu's order. A search from the shell's bar, which rides in the address as
 * `?q=`, shows what it found in place of all of it. A locked library never
 * shows on it, PIN or not.
 */
export const HomePage = () => {
  const titleId = useId()
  const [address] = useSearchParams()
  const query = (address.get(PAGE_PARAMS.search) ?? '').trim()
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
