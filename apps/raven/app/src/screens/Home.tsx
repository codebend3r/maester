import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import type { ShelfCard } from '@/queries/cards'
import { homeShelvesOf } from '@/queries/homeShelves'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { Shelf, Shelves } from '@/layouts'
import { APP_ROUTES, ROUTE_TARGETS, hrefOf } from '@/routes'

const COPY = {
  title: 'Home',
  loading: 'Gathering your libraries',
  bare: 'Nothing to show yet. Pin a library in its settings and its newest videos show here, and whatever you start watching waits at the top.',
} as const

type ServerHomeProps = { session: AppQueries }

const ServerHome = ({ session: { server, api, queries } }: ServerHomeProps) => {
  const router = useRouter()
  const home = useQuery(queries.homeQuery)
  const libraries = useQuery(queries.librariesQuery)
  const pictures = usePictures({ server, api })

  const shelves =
    home.data === undefined || libraries.data === undefined || pictures === null
      ? []
      : homeShelvesOf({ home: home.data, libraries: libraries.data, ...pictures })
  const failure = home.error ?? libraries.error
  const isBare = home.isSuccess && libraries.isSuccess && pictures !== null && shelves.length === 0
  const isLoading = failure === null && !isBare && shelves.length === 0
  const notice = ((): string | null => {
    if (failure !== null) return failure.message
    if (isBare) return COPY.bare
    return isLoading ? COPY.loading : null
  })()

  // Focus starts on a card, so on the first shelf that has one.
  const focusShelf = shelves.findIndex(({ cards }) => cards.length > 0)

  const pinnedLibraries = (libraries.data ?? [])
    .filter((library) => library.settings.pinned)
    .map(({ id, name }) => ({ id, name }))

  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))

  const openLibrary = (libraryId: number) =>
    router.push(hrefOf({ kind: ROUTE_TARGETS.library, libraryId, query: '' }))

  return (
    <Shelves
      isLoading={isLoading}
      notice={notice}
      libraries={pinnedLibraries}
      onOpenLibrary={openLibrary}
      onSearch={() => router.push(APP_ROUTES.search)}
      onSettings={() => router.push(APP_ROUTES.settings)}
      title={COPY.title}
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
