import { isString } from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import type { ShelfCard } from '@/queries/cards'
import { libraryShelvesOf } from '@/queries/homeShelves'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { SearchLayout, Shelf } from '@/layouts'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { SEARCH_COPY } from '@/screens/copy'

type ServerSearchProps = { session: AppQueries; asked: string }

const ServerSearch = ({ session: { server, api, queries }, asked }: ServerSearchProps) => {
  const router = useRouter()
  const search = useSearch({ initial: asked })
  const { query } = search
  const isAsked = query !== ''
  // An empty query is a skipToken: a cleared box asks the server nothing.
  const results = useQuery(queries.homeSearchQuery(query))
  const libraries = useQuery(queries.librariesQuery)
  const pictures = usePictures({ server, api })

  const shelves =
    !isAsked || results.data === undefined || libraries.data === undefined || pictures === null
      ? []
      : libraryShelvesOf({ shelves: results.data, libraries: libraries.data, ...pictures })
  const notice = ((): string | null => {
    if (!isAsked) return null
    const failure = results.error ?? libraries.error
    if (failure !== null) return failure.message
    if (shelves.length > 0) return null
    // The last search's answer stands in while this one is read: it says nothing of this one.
    const isRead =
      results.isSuccess && !results.isPlaceholderData && libraries.isSuccess && pictures !== null
    return isRead ? SEARCH_COPY.nothingMatches(query) : SEARCH_COPY.searching
  })()

  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))

  // The library opens on the search, so it lists every match, not only the shelf's.
  const openLibrary = (libraryId: number) =>
    router.push(hrefOf({ kind: ROUTE_TARGETS.library, libraryId, query }))

  return (
    <SearchLayout
      label={SEARCH_COPY.label}
      notice={notice}
      onBack={() => router.back()}
      search={search}
      title={SEARCH_COPY.title}
    >
      {shelves.map((shelf) => (
        <Shelf key={shelf.key} onOpen={open} onOpenLibrary={openLibrary} shelf={shelf} />
      ))}
    </SearchLayout>
  )
}

/**
 * `/search`: the search through every library, as the web's Home searches. It asks once
 * typing pauses, or at once when the keyboard sends it, and shows a shelf for each library
 * holding a match, in the libraries' order; a shelf's See all opens its library on the
 * search; `?q=` opens it on a search a header's field ran. Each server gets a search of its own.
 */
export const Search = () => {
  const session = useAppQueries()
  const query = useLocalSearchParams()[APP_ROUTE_PARAMS.query]
  return (
    session !== null && (
      <ServerSearch
        key={session.server.id}
        asked={isString(query) ? query : ''}
        session={session}
      />
    )
  )
}
