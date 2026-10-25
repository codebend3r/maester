import { useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import type { ShelfCard } from '@/queries/cards'
import { libraryShelvesOf } from '@/queries/homeShelves'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useAccessToken } from '@/account/accountSession'
import { useServerCookies } from '@/queries/useServerCookies'
import { SearchLayout, Shelf } from '@/layouts'
import { ROUTE_TARGETS, hrefOf } from '@/routes'
import { cookieHeadersFor } from '@/servers/serverHeaders'

const COPY = {
  title: 'Search',
  label: 'Search every library',
  searching: 'Searching every library',
} as const

/** What the screen says when a search finds nothing, as the web's Home says it. */
const nothingMatches = (query: string): string => `Nothing in any library matches "${query}".`

const ServerSearch = ({ session: { server, api, queries } }: { session: AppQueries }) => {
  const router = useRouter()
  const search = useSearch()
  const { query } = search
  const isAsked = query !== ''
  // An empty query is a skipToken: a cleared box asks the server nothing.
  const results = useQuery(queries.homeSearchQuery(query))
  const libraries = useQuery(queries.librariesQuery)
  const cookies = useServerCookies(server)
  const accessToken = useAccessToken()

  const shelves =
    !isAsked || results.data === undefined || libraries.data === undefined || cookies === null
      ? []
      : libraryShelvesOf({
          shelves: results.data,
          libraries: libraries.data,
          api,
          headersFor: cookieHeadersFor({ server, cookies, accessToken }),
        })
  const notice = ((): string | null => {
    if (!isAsked) return null
    const failure = results.error ?? libraries.error
    if (failure !== null) return failure.message
    if (shelves.length > 0) return null
    // The last search's answer stands in while this one is read: it says nothing of this one.
    const isRead =
      results.isSuccess && !results.isPlaceholderData && libraries.isSuccess && cookies !== null
    return isRead ? nothingMatches(query) : COPY.searching
  })()

  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))

  // The library opens on the search, so it lists every match, not only the shelf's.
  const openLibrary = (libraryId: number) =>
    router.push(hrefOf({ kind: ROUTE_TARGETS.library, libraryId, query }))

  return (
    <SearchLayout
      label={COPY.label}
      notice={notice}
      onBack={() => router.back()}
      search={search}
      title={COPY.title}
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
 * search. Each server gets a search of its own.
 */
export const Search = () => {
  const session = useAppQueries()
  return session !== null && <ServerSearch key={session.server.id} session={session} />
}
