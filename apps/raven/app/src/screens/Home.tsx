import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { type AlbumShelf, pinnedShelvesOf, shelvesInOrder } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf, useReleasedShelves } from '@raven/ui/headless'

import type { BingeCard } from '@/queries/bingeCards'
import type { ShelfCard } from '@/queries/cards'
import { type HeroSlide, heroSlidesOf } from '@/queries/heroSlides'
import { type ShelfView, homeShelvesOf } from '@/queries/homeShelves'
import { showArtIdsOf } from '@/queries/showArt'
import { usePinnedHere } from '@/queries/accountPins'
import { openPinned, usePinnedLibraries } from '@/queries/pinnedLibraries'
import { useShowArts } from '@/queries/useShowArts'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { useBingeCards } from '@/queries/useBingeCards'
import { BingeShelf, HomeHero, Loading, Shelf, Shelves } from '@/layouts'
import type { LoadingProps } from '@/layouts/loadingKit'
import type { ShelvesProps } from '@/layouts/shelfKit'
import { APP_ROUTES, ROUTE_TARGETS, type RouteTarget, hrefOf } from '@/routes'
import { HOME_COPY } from '@/screens/copy'
import { shelfOrdersOn, useLibraryViews } from '@/stores/libraryViews'

type HomeShelvesProps = {
  /** The shows the viewer binges, first on the page; none leaves the hero at the top. */
  binge: readonly BingeCard[]
  /** The titles the hero takes turns with, over the shelves; none leaves the shelves at the top. */
  slides: readonly HeroSlide[]
  shelves: readonly ShelfView[]
  notice: string | null
  libraries: ShelvesProps['libraries']
  /** Turns a library's shelf to its other order. */
  onTurnOrder: (libraryId: number) => void
}

/**
 * Home: the shows the viewer binges, then the hero, then Continue watching and the library
 * shelves, beside the side menu on a TV. The focus starts on the first binge card, else on the
 * hero's Play, else on the first card.
 */
const HomeShelves = ({
  binge,
  slides,
  shelves,
  notice,
  libraries,
  onTurnOrder,
}: HomeShelvesProps) => {
  const router = useRouter()
  const hasBinge = binge.length > 0
  const hasHero = slides.length > 0

  // Focus starts on Binge, then the hero, else on a card, so on the first shelf that has one.
  const focusShelf = hasBinge || hasHero ? -1 : shelves.findIndex(({ cards }) => cards.length > 0)

  const go = (target: RouteTarget) => router.push(hrefOf(target))
  const open = ({ target }: ShelfCard) => go(target)

  const openLibrary = (libraryId: number) =>
    router.push(hrefOf({ kind: ROUTE_TARGETS.library, libraryId, query: '' }))

  return (
    <Shelves
      notice={notice}
      libraries={libraries}
      onOpenLibrary={openLibrary}
      onOpenPinned={(library) => openPinned({ library, go: (href) => router.push(href) })}
      onSearch={() => router.push(APP_ROUTES.search)}
      onSettings={() => router.push(APP_ROUTES.settings)}
      title={HOME_COPY.title}
    >
      {hasBinge && <BingeShelf key="binge" cards={binge} isFirst onOpen={go} />}
      {hasHero && <HomeHero key="hero" isPreferred={!hasBinge} onOpen={go} slides={slides} />}
      {shelves.map((shelf, index) => (
        <Shelf
          key={shelf.key}
          isFirst={index === focusShelf}
          onOpen={open}
          onOpenContinue={() => router.push(APP_ROUTES.continueWatching)}
          onOpenLibrary={openLibrary}
          onTurnOrder={onTurnOrder}
          shelf={shelf}
        />
      ))}
    </Shelves>
  )
}

/** What Home draws: the mark while the shelves load, then the shelves. */
const HOME_VIEW_KEYS = { loading: 'loading', shelves: 'shelves' } as const

type HomeViewProps = {
  [HOME_VIEW_KEYS.loading]: LoadingProps
  [HOME_VIEW_KEYS.shelves]: HomeShelvesProps
}

const HOME_VIEWS = {
  [HOME_VIEW_KEYS.loading]: Loading,
  [HOME_VIEW_KEYS.shelves]: HomeShelves,
} as const satisfies ViewsOf<HomeViewProps>

type ServerHomeProps = { session: AppQueries }

// One empty list for albums that cannot be read, so the shelves are not built again for a new one.
const NO_ALBUMS: readonly AlbumShelf[] = []

const ServerHome = ({ session }: ServerHomeProps) => {
  const { server, api, queries } = session
  const home = useQuery(queries.homeQuery)
  const pinnedHere = usePinnedHere()
  const pinnedLibraries = usePinnedLibraries({ queries })
  const hero = useQuery(queries.heroQuery)
  const albums = useQuery(queries.homeAlbumsQuery)
  const choices = useLibraryViews((state) => state.choices)
  const turnShelfOrder = useLibraryViews((state) => state.turnShelfOrder)
  const orders = useMemo(
    () => shelfOrdersOn({ choices, serverId: server.id }),
    [choices, server.id],
  )
  const released = useReleasedShelves({ queries, orders })
  const libraries = useQuery(queries.librariesQuery)
  const pictures = usePictures({ server, api })
  const binge = useBingeCards({ queries, pictures })
  const arts = useShowArts({
    queries,
    ids: showArtIdsOf(home.data?.inProgress ?? []),
    pictures,
  })

  /*
   * The shelves wait for the albums too, so a music library's row never flips from its files
   * to its covers as they land; albums that cannot be read leave each row as its files.
   */
  const addedAlbums = albums.data ?? (albums.isError ? NO_ALBUMS : null)
  const albumShelves = useMemo(
    () =>
      addedAlbums === null
        ? null
        : shelvesInOrder({ shelves: addedAlbums, released: released.albums, orders }),
    [addedAlbums, released.albums, orders],
  )
  /*
   * Built only when what they are made of changes, never on every render: Home renders again as
   * each of its queries lands, and on a TV's Hermes building hundreds of cards each time held
   * the remote's focus back for seconds.
   */
  const homeData = useMemo(
    () =>
      home.data === undefined
        ? undefined
        : {
            ...home.data,
            shelves: shelvesInOrder({
              shelves: pinnedShelvesOf({ shelves: home.data.shelves, pinnedHere }),
              released: released.shelves,
              orders,
            }),
          },
    [home.data, pinnedHere, released.shelves, orders],
  )
  const shelves = useMemo(
    () =>
      homeData === undefined ||
      libraries.data === undefined ||
      albumShelves === null ||
      pictures === null
        ? []
        : homeShelvesOf({
            home: homeData,
            libraries: libraries.data,
            albumShelves,
            arts,
            orders,
            ...pictures,
          }),
    [homeData, libraries.data, albumShelves, arts, orders, pictures],
  )
  const slides = useMemo(
    () =>
      hero.data === undefined || libraries.data === undefined || pictures === null
        ? []
        : heroSlidesOf({ hero: hero.data, libraries: libraries.data, ...pictures }),
    [hero.data, libraries.data, pictures],
  )
  const failure = home.error ?? libraries.error
  const isBare =
    home.isSuccess &&
    libraries.isSuccess &&
    albumShelves !== null &&
    pictures !== null &&
    shelves.length === 0
  // The hero is waited for, so its Play is there to take the opening focus; one that fails is left out.
  const isLoading = failure === null && ((!isBare && shelves.length === 0) || hero.isPending)
  const notice = ((): string | null => {
    if (failure !== null) return failure.message
    return isBare ? HOME_COPY.bare : null
  })()

  const view: ViewOf<HomeViewProps> = isLoading
    ? { key: HOME_VIEW_KEYS.loading, props: { label: HOME_COPY.loading, isHome: true } }
    : {
        key: HOME_VIEW_KEYS.shelves,
        props: {
          binge,
          slides,
          shelves,
          notice,
          libraries: pinnedLibraries,
          onTurnOrder: (libraryId) => turnShelfOrder({ serverId: server.id, libraryId }),
        },
      }
  return <KeyedView<HomeViewProps> view={view} views={HOME_VIEWS} />
}

/**
 * `/`: the shows being binged, the featured titles, what is being watched, then each pinned
 * library's newest arrivals, or its newest releases once its toggle turns it, as shelves of cards. A card
 * opens its item, a library shelf's See all the library, and Search the search through every
 * library. Each server gets a Home of its own, so nothing one showed, its scroll or its focus,
 * carries over to the next.
 */
export const Home = () => {
  const session = useAppQueries()
  return session !== null && <ServerHome key={session.server.id} session={session} />
}
