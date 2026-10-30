import {
  type Library as LibraryRecord,
  type LibrarySettings,
  type PosterEntry,
  KINDS,
  LIBRARY_LISTINGS,
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
  libraryIconOf,
  listingFor,
  listsShows,
  plural,
  reversedSort,
  routeIdOf,
  routeState,
  sortFieldsFor,
  sortParts,
  startingSort,
} from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type ReactNode, useState } from 'react'

import { AlbumsGrid } from '@/music/AlbumsGrid'
import type { ShelfCard } from '@/queries/cards'
import { CONTINUE_WATCHING, continueArtIdsOf } from '@/queries/homeShelves'
import { useArtLogos } from '@/queries/useArtLogos'
import { type Listing, continueSectionsOf, librarySectionsOf } from '@/queries/libraryGrid'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { Grid, Loading, Picker, SearchField, ToolButton } from '@/layouts'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'
import { appViewsFor, useLibraryView } from '@/screens/useLibraryView'
import type { LibraryChoice } from '@/stores/libraryViews'

const COPY = {
  library: 'Library',
  opening: 'Opening the library',
  missing: 'This library is not on the server.',
  nothingInProgress: 'Nothing in progress here yet.',
  showPage: (page: string) => `Show ${page}`,
  gathering: { shows: 'Gathering the shows', videos: 'Gathering the videos' },
  sort: 'Sort',
  order: 'Order',
  view: 'View',
  groupBy: 'Group by',
  search: 'Search',
} as const

/**
 * The two pages a library opens on: what is being watched in it, for picking up where one left
 * off, and the library itself, its listing sorted, laid out and searched.
 */
const LIBRARY_PAGES = { continue: 'continue', library: 'library' } as const

type LibraryPage = (typeof LIBRARY_PAGES)[keyof typeof LIBRARY_PAGES]

const PAGE_NAMES = {
  [LIBRARY_PAGES.continue]: CONTINUE_WATCHING,
  [LIBRARY_PAGES.library]: COPY.library,
} as const satisfies Record<LibraryPage, string>

/** The page the other one's button leads to. */
const otherPageOf = (page: LibraryPage): LibraryPage =>
  page === LIBRARY_PAGES.continue ? LIBRARY_PAGES.library : LIBRARY_PAGES.continue

type PageToggleProps = { page: LibraryPage; onChange: (page: LibraryPage) => void }

/** The one press from either page to the other: named for where it goes. */
const PageToggle = ({ page, onChange }: PageToggleProps) => {
  const other = otherPageOf(page)
  return (
    <ToolButton
      accessibilityLabel={COPY.showPage(PAGE_NAMES[other])}
      label={PAGE_NAMES[other]}
      onPress={() => onChange(other)}
    />
  )
}

type LibraryToolbarProps = {
  settings: LibrarySettings
  onChange: (change: LibraryChoice) => void
}

/**
 * Sort, its direction, view and, in the grouped view, the grouping, as the web's toolbar
 * offers them: each the library's type's own, so a sort it cannot use is never offered.
 */
const LibraryToolbar = ({ settings, onChange }: LibraryToolbarProps) => {
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
        options={appViewsFor(settings.kind).map((view) => ({
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

type UseListingProps = {
  queries: AppQueries['queries']
  library: LibraryRecord
  settings: LibrarySettings
  search: string
  seed: number
}

/**
 * What the library holds: its shows and the files no show was found for, or its files, of
 * those the search finds. The server searches, as it does for the web.
 */
const useListing = ({ queries, library, settings, search, seed }: UseListingProps) => {
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

type ContinueGridProps = {
  session: AppQueries
  library: LibraryRecord
  entries: readonly PosterEntry[]
  toggle: ReactNode
}

/**
 * A library's Continue watching page: its videos with a saved spot, most recently watched
 * first, wide as Home's shelf draws them, under the library's name and the way to its listing.
 */
const ContinueGrid = ({
  session: { server, api, queries },
  library,
  entries,
  toggle,
}: ContinueGridProps) => {
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const logos = useArtLogos({ queries, ids: continueArtIdsOf(entries), pictures })
  const sections = pictures === null ? [] : continueSectionsOf({ entries, logos, ...pictures })
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={`${CONTINUE_WATCHING}, ${plural({ n: entries.length, one: 'video', many: 'videos' })}`}
      notice={entries.length === 0 ? COPY.nothingInProgress : null}
      onBack={() => router.back()}
      onOpen={({ target }) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={library.name}
      toolbar={toggle}
      view={LIBRARY_VIEWS.grid}
    />
  )
}

type LibraryPagesProps = {
  session: AppQueries
  library: LibraryRecord
  asked: string
}

/**
 * A library's two pages, Continue watching and the library itself, with the one press between
 * them. It opens on Continue watching while anything in it is in progress, so a show is picked
 * up in one press, and on the library otherwise; a search handed over opens the library too.
 */
const LibraryPages = ({ session, library, asked }: LibraryPagesProps) => {
  const router = useRouter()
  const inProgress = useQuery(session.queries.inProgressQuery(library.id))
  const [chosen, setChosen] = useState<LibraryPage | null>(null)
  const entries = inProgress.data ?? null
  if (entries === null && inProgress.isPending && chosen === null) {
    return <Loading label={COPY.opening} onBack={() => router.back()} />
  }
  const isContinuing = asked === '' && entries !== null && entries.length > 0
  const page = chosen ?? (isContinuing ? LIBRARY_PAGES.continue : LIBRARY_PAGES.library)
  const toggle = <PageToggle onChange={setChosen} page={page} />
  switch (page) {
    case LIBRARY_PAGES.continue:
      return (
        <ContinueGrid entries={entries ?? []} library={library} session={session} toggle={toggle} />
      )
    case LIBRARY_PAGES.library:
      return <LibraryGrid asked={asked} library={library} session={session} toggle={toggle} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

type LibraryGridProps = {
  session: AppQueries
  library: LibraryRecord
  asked: string
  /** The way to the Continue watching page, first in the toolbar. */
  toggle: ReactNode
}

/**
 * A library once it is known: its cards, laid out as this device last left it, of those its
 * search finds. The search starts on the one it was opened with.
 */
const LibraryGrid = ({
  session: { server, api, queries },
  library,
  asked,
  toggle,
}: LibraryGridProps) => {
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
  const pictures = usePictures({ server, api })

  const sections =
    listed === null || pictures === null
      ? []
      : librarySectionsOf({ settings, listing: listed, now: new Date(), ...pictures })
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
      icon={libraryIconOf(library.settings)}
      jump={jump}
      line={`${KINDS[settings.kind].label}, ${plural({ n: library.itemCount, one: 'video', many: 'videos' })}`}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
      search={<SearchField label={`${COPY.search} ${library.name}`} search={search} />}
      sections={sections}
      title={library.name}
      toolbar={
        <>
          {toggle}
          <LibraryToolbar onChange={view.change} settings={settings} />
        </>
      }
      view={settings.view}
    />
  )
}

type LibraryNoticeProps = { notice: string }

/** The grid's frame with only a line in it: while the library is read, or when it is not there. */
const LibraryNotice = ({ notice }: LibraryNoticeProps) => {
  const router = useRouter()
  return (
    <Grid
      icon={null}
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

type ServerLibraryProps = {
  session: AppQueries
  id: number | null
  asked: string
}

const ServerLibrary = ({ session, id, asked }: ServerLibraryProps) => {
  const router = useRouter()
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
      return <Loading label={COPY.opening} onBack={() => router.back()} />
    case ROUTE_STATES.ready:
      return listingFor(page.data.settings.kind) === LIBRARY_LISTINGS.albums ? (
        <AlbumsGrid key={page.data.id} asked={asked} library={page.data} session={session} />
      ) : (
        <LibraryPages key={page.data.id} asked={asked} library={page.data} session={session} />
      )
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
