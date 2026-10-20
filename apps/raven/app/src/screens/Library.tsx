import {
  type Library as LibraryRecord,
  type LibrarySettings,
  KINDS,
  LIBRARY_VIEWS,
  GROUPING_LABELS,
  LIBRARY_VIEW_LABELS,
  ROUTE_STATES,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
  emptyListingMessage,
  groupingsFor,
  isScanning,
  isString,
  jumpScale,
  listsShows,
  plural,
  reversedSort,
  routeIdOf,
  routeState,
  sortFieldsFor,
  sortParts,
  startingSort,
  viewsFor,
} from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import type { ShelfCard } from '@/queries/cards'
import { type Listing, librarySectionsOf } from '@/queries/libraryGrid'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useServerCookies } from '@/queries/useServerCookies'
import { Grid, Picker, SearchField, ToolButton } from '@/layouts'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'
import { useLibraryView } from '@/screens/useLibraryView'
import type { LibraryChoice } from '@/stores/libraryViews'
import { cookieHeadersFor } from '@/servers/serverHeaders'

const COPY = {
  library: 'Library',
  opening: 'Opening the library',
  missing: 'This library is not on the server.',
  gathering: { shows: 'Gathering the shows', videos: 'Gathering the videos' },
  sort: 'Sort',
  order: 'Order',
  view: 'View',
  groupBy: 'Group by',
  search: 'Search',
} as const

/**
 * Sort, its direction, view and, in the grouped view, the grouping, as the web's toolbar
 * offers them: each the library's type's own, so a sort it cannot use is never offered.
 */
const LibraryToolbar = ({
  settings,
  onChange,
}: {
  settings: LibrarySettings
  onChange: (change: LibraryChoice) => void
}) => {
  const parts = sortParts(settings.sort)
  return (
    <>
      <Picker
        label={COPY.sort}
        onChoose={(field) => onChange({ sort: startingSort(field) })}
        options={sortFieldsFor(settings.kind).map((field) => ({
          key: field,
          label: SORT_FIELD_LABELS[field],
        }))}
        value={parts.field}
      />
      {parts.direction !== null && (
        <ToolButton
          accessibilityLabel={`${COPY.order}: ${SORT_DIRECTION_LABELS[parts.field][parts.direction]}`}
          label={SORT_DIRECTION_LABELS[parts.field][parts.direction]}
          onPress={() => onChange({ sort: reversedSort(settings.sort) })}
        />
      )}
      <Picker
        label={COPY.view}
        onChoose={(view) => onChange({ view })}
        options={viewsFor(settings.kind).map((view) => ({
          key: view,
          label: LIBRARY_VIEW_LABELS[view],
        }))}
        value={settings.view}
      />
      {settings.view === LIBRARY_VIEWS.grouped && (
        <Picker
          label={COPY.groupBy}
          onChoose={(groupBy) => onChange({ groupBy })}
          options={groupingsFor(settings.kind).map((grouping) => ({
            key: grouping,
            label: GROUPING_LABELS[grouping],
          }))}
          value={settings.groupBy}
        />
      )}
    </>
  )
}

/**
 * What the library holds: its shows and the files no show was found for, or its files, of
 * those the search finds. The server searches, as it does for the web.
 */
const useListing = ({
  queries,
  library,
  settings,
  search,
  seed,
}: {
  queries: AppQueries['queries']
  library: LibraryRecord
  settings: LibrarySettings
  search: string
  seed: number
}) => {
  const isShowList = listsShows(settings.kind)
  const listing = { libraryId: library.id, search, sort: settings.sort, seed }
  const shows = useQuery({ ...queries.showListQuery(listing), enabled: isShowList })
  const files = useQuery({ ...queries.mediaListQuery(listing), enabled: !isShowList })
  const query = isShowList ? shows : files
  const listed = ((): Listing | null => {
    if (isShowList) {
      return shows.data === undefined
        ? null
        : { shows: shows.data.shows, files: shows.data.unmatched }
    }
    return files.data === undefined ? null : { shows: [], files: files.data }
  })()
  // While a new search is read, the last one's answer stands in for it.
  return { listed, error: query.error, isStandIn: query.isPlaceholderData }
}

/**
 * A library once it is known: its cards, laid out as this device last left it, of those its
 * search finds. The search starts on the one it was opened with.
 */
const LibraryGrid = ({
  session: { server, api, queries },
  library,
  asked,
}: {
  session: AppQueries
  library: LibraryRecord
  asked: string
}) => {
  const router = useRouter()
  const view = useLibraryView({ serverId: server.id, library })
  const search = useSearch({ initial: asked })
  const { settings } = view
  const { listed, error, isStandIn } = useListing({
    queries,
    library,
    settings,
    search: search.query,
    seed: view.seed,
  })
  const cookies = useServerCookies(server)

  const sections =
    listed === null || cookies === null
      ? []
      : librarySectionsOf({
          settings,
          listing: listed,
          api,
          headersFor: cookieHeadersFor({ server, cookies }),
          now: new Date(),
        })
  // Nothing matches only once the server says so, not while the last search stands in.
  const empty =
    listed === null || isStandIn
      ? null
      : emptyListingMessage({
          isEmpty: listed.shows.length === 0 && listed.files.length === 0,
          query: search.query,
          isScanning: isScanning(library.scan),
        })
  const notice = ((): string | null => {
    if (error !== null && listed === null) return error.message
    if (empty !== null) return empty
    if (sections.length > 0) return null
    return listsShows(settings.kind) ? COPY.gathering.shows : COPY.gathering.videos
  })()
  // The strip follows the order: letters for titles, steps of the value sorted by for the rest.
  const jump =
    listed === null || empty !== null
      ? null
      : jumpScale({
          sort: settings.sort,
          files: listed.files,
          shows: listed.shows,
          source: settings.ratingsSource,
        })

  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))

  return (
    <Grid
      jump={jump}
      line={`${KINDS[settings.kind].label}, ${plural({ n: library.itemCount, one: 'video', many: 'videos' })}`}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
      search={<SearchField label={`${COPY.search} ${library.name}`} search={search} />}
      sections={sections}
      title={library.name}
      toolbar={<LibraryToolbar onChange={view.change} settings={settings} />}
      view={settings.view}
    />
  )
}

/** The grid's frame with only a line in it: while the library is read, or when it is not there. */
const LibraryNotice = ({ notice }: { notice: string }) => {
  const router = useRouter()
  return (
    <Grid
      jump={null}
      line={null}
      notice={notice}
      onBack={() => router.back()}
      onOpen={() => undefined}
      search={null}
      sections={[]}
      title={COPY.library}
      toolbar={null}
      view={LIBRARY_VIEWS.grid}
    />
  )
}

const ServerLibrary = ({
  session,
  id,
  asked,
}: {
  session: AppQueries
  id: number | null
  asked: string
}) => {
  const queryClient = useQueryClient()
  const { queries } = session
  // The libraries Home read already hold this one, so the page opens on that while it is read.
  const library = useQuery({
    ...queries.libraryQuery(id),
    placeholderData: () =>
      (queryClient.getQueryData(queries.librariesQuery.queryKey) ?? []).find(
        (entry) => entry.id === id,
      ),
  })
  const page = routeState({ id, query: library })
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <LibraryNotice notice={COPY.missing} />
    case ROUTE_STATES.error:
      return <LibraryNotice notice={page.message} />
    case ROUTE_STATES.loading:
      return <LibraryNotice notice={COPY.opening} />
    case ROUTE_STATES.ready:
      return <LibraryGrid key={page.data.id} asked={asked} library={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/**
 * `/library/[id]`: a library's videos or shows, searched, sorted, laid out and grouped as this
 * device last left it, in the ways its type allows, with the web's jump strip. A card opens
 * its item. `?q=` opens it on a search, as a search through every library hands one over.
 */
export const Library = () => {
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  const query = params[APP_ROUTE_PARAMS.query]
  const session = useAppQueries()
  return (
    session !== null && (
      <ServerLibrary
        key={session.server.id}
        asked={isString(query) ? query : ''}
        id={id}
        session={session}
      />
    )
  )
}
