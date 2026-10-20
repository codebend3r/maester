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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import type { ShelfCard } from '@/queries/cards'
import { type Listing, librarySectionsOf } from '@/queries/libraryGrid'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useServerCookies } from '@/queries/useServerCookies'
import { Grid, Picker, ToolButton } from '@/layouts'
import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
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

/** What the library holds: its shows and the files no show was found for, or its files. */
const useListing = ({
  queries,
  library,
  settings,
  seed,
}: {
  queries: AppQueries['queries']
  library: LibraryRecord
  settings: LibrarySettings
  seed: number
}) => {
  const isShowList = listsShows(settings.kind)
  const listing = { libraryId: library.id, search: '', sort: settings.sort, seed }
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
  return { listed, error: query.error }
}

/** A library once it is known: its cards, laid out as this device last left it. */
const LibraryGrid = ({
  session: { server, api, queries },
  library,
}: {
  session: AppQueries
  library: LibraryRecord
}) => {
  const router = useRouter()
  const view = useLibraryView({ serverId: server.id, library })
  const { settings } = view
  const { listed, error } = useListing({ queries, library, settings, seed: view.seed })
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
  const empty =
    listed === null
      ? null
      : emptyListingMessage({
          isEmpty: listed.shows.length === 0 && listed.files.length === 0,
          query: '',
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

  const open = ({ itemId }: ShelfCard) => {
    if (itemId === null) return
    router.push({ pathname: APP_ROUTES.item, params: { id: String(itemId) } })
  }

  return (
    <Grid
      jump={jump}
      line={`${KINDS[settings.kind].label}, ${plural({ n: library.itemCount, one: 'video', many: 'videos' })}`}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
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
      sections={[]}
      title={COPY.library}
      toolbar={null}
      view={LIBRARY_VIEWS.grid}
    />
  )
}

const ServerLibrary = ({ session, id }: { session: AppQueries; id: number | null }) => {
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
      return <LibraryGrid key={page.data.id} library={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/**
 * `/library/[id]`: a library's videos or shows, sorted, laid out and grouped as this device
 * last left it, in the ways its type allows, with the web's jump strip. A card opens its item.
 */
export const Library = () => {
  const id = routeIdOf(useLocalSearchParams()[APP_ROUTE_PARAMS.id])
  const session = useAppQueries()
  return session !== null && <ServerLibrary key={session.server.id} id={id} session={session} />
}
