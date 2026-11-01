import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'

import type { ShelfCard } from '@/queries/cards'
import { type ShelfView, homeShelvesOf } from '@/queries/homeShelves'
import { showArtIdsOf } from '@/queries/showArt'
import { pinnedLibrariesOf } from '@/queries/pinnedLibraries'
import { useShowArts } from '@/queries/useShowArts'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { Loading, Shelf, Shelves } from '@/layouts'
import type { LoadingProps } from '@/layouts/loadingKit'
import type { ShelvesProps } from '@/layouts/shelfKit'
import { APP_ROUTES, ROUTE_TARGETS, hrefOf } from '@/routes'
import { HOME_COPY } from '@/screens/copy'

type HomeShelvesProps = {
  shelves: readonly ShelfView[]
  notice: string | null
  libraries: ShelvesProps['libraries']
}

/** Home's shelves beside the side menu, the focus on the first card. */
const HomeShelves = ({ shelves, notice, libraries }: HomeShelvesProps) => {
  const router = useRouter()

  // Focus starts on a card, so on the first shelf that has one.
  const focusShelf = shelves.findIndex(({ cards }) => cards.length > 0)

  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))

  const openLibrary = (libraryId: number) =>
    router.push(hrefOf({ kind: ROUTE_TARGETS.library, libraryId, query: '' }))

  return (
    <Shelves
      notice={notice}
      libraries={libraries}
      onOpenLibrary={openLibrary}
      onSearch={() => router.push(APP_ROUTES.search)}
      onSettings={() => router.push(APP_ROUTES.settings)}
      title={HOME_COPY.title}
    >
      {shelves.map((shelf, index) => (
        <Shelf
          key={shelf.key}
          isFirst={index === focusShelf}
          onOpen={open}
          onOpenLibrary={openLibrary}
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

const ServerHome = ({ session: { server, api, queries } }: ServerHomeProps) => {
  const home = useQuery(queries.homeQuery)
  const libraries = useQuery(queries.librariesQuery)
  const pictures = usePictures({ server, api })
  const arts = useShowArts({
    queries,
    ids: showArtIdsOf(home.data?.inProgress ?? []),
    pictures,
  })

  const shelves =
    home.data === undefined || libraries.data === undefined || pictures === null
      ? []
      : homeShelvesOf({ home: home.data, libraries: libraries.data, arts, ...pictures })
  const failure = home.error ?? libraries.error
  const isBare = home.isSuccess && libraries.isSuccess && pictures !== null && shelves.length === 0
  const isLoading = failure === null && !isBare && shelves.length === 0
  const notice = ((): string | null => {
    if (failure !== null) return failure.message
    return isBare ? HOME_COPY.bare : null
  })()

  const pinnedLibraries = pinnedLibrariesOf(libraries.data ?? [])

  const view: ViewOf<HomeViewProps> = isLoading
    ? { key: HOME_VIEW_KEYS.loading, props: { label: HOME_COPY.loading } }
    : { key: HOME_VIEW_KEYS.shelves, props: { shelves, notice, libraries: pinnedLibraries } }
  return <KeyedView<HomeViewProps> view={view} views={HOME_VIEWS} />
}

/**
 * `/`: what is being watched, then each pinned library's newest, as shelves of cards. A card
 * opens its item, a library shelf's See all the library, and Search the search through every
 * library. Each server gets a Home of its own, so nothing one showed, its scroll or its focus,
 * carries over to the next.
 */
export const Home = () => {
  const session = useAppQueries()
  return session !== null && <ServerHome key={session.server.id} session={session} />
}
