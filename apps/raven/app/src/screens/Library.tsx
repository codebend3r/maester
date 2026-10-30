import {
  type Library as LibraryRecord,
  type LibrarySettings,
  type MediaItem,
  type PosterEntry,
  KINDS,
  LIBRARY_LISTINGS,
  LIBRARY_VIEWS,
  GROUPING_LABELS,
  LIBRARY_VIEW_LABELS,
  ROUTE_STATES,
  type RouteQuery,
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
  shuffleChoices,
  sortFieldsFor,
  sortParts,
  startingSort,
} from '@raven/core'
import { useSearch, KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type ReactNode, useState } from 'react'

import { MusicPages } from '@/music/MusicPages'
import type { ShelfCard } from '@/queries/cards'
import { CONTINUE_WATCHING, continueArtIdsOf } from '@/queries/homeShelves'
import { useArtLogos } from '@/queries/useArtLogos'
import { type Listing, continueSectionsOf, librarySectionsOf } from '@/queries/libraryGrid'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { Grid, Loading, Picker, SearchField, ToolButton } from '@/layouts'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'
import { LIBRARY_COPY } from '@/screens/copy'
import { shuffleTarget } from '@/screens/shuffleTarget'
import type { LoadingProps } from '@/layouts/loadingKit'
import { appViewsFor, useLibraryView } from '@/screens/useLibraryView'
import type { LibraryChoice } from '@/stores/libraryViews'

/**
 * The two pages a library opens on: what is being watched in it, for picking up where one left
 * off, and the library itself, its listing sorted, laid out and searched.
 */
const LIBRARY_PAGES = { continue: 'continue', library: 'library' } as const

type LibraryPage = (typeof LIBRARY_PAGES)[keyof typeof LIBRARY_PAGES]

const PAGE_NAMES = {
  [LIBRARY_PAGES.continue]: CONTINUE_WATCHING,
  [LIBRARY_PAGES.library]: LIBRARY_COPY.library,
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
      accessibilityLabel={LIBRARY_COPY.showPage(PAGE_NAMES[other])}
      label={PAGE_NAMES[other]}
      onPress={() => onChange(other)}
    />
  )
}

type ShuffleButtonProps = { library: LibraryRecord; choices: readonly MediaItem[] }

/** Shuffle, first after the way to the other page: one of `choices` at random, from where it was left. */
const ShuffleButton = ({ library, choices }: ShuffleButtonProps) => {
  const router = useRouter()
  return (
    <ToolButton
      accessibilityLabel={LIBRARY_COPY.shuffleLibrary(library.name)}
      label={LIBRARY_COPY.shuffle}
      onPress={() => {
        const target = shuffleTarget({ choices })
        if (target !== null) router.push(hrefOf(target))
      }}
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
        label={LIBRARY_COPY.sort}
        onChoose={(field) => onChange({ sort: startingSort(field) })}
        options={sortFieldsFor(settings.kind).map((field) => ({
          key: field,
          label: SORT_FIELD_LABELS[field],
        }))}
        value={parts.field}
      />
      {parts.direction !== null && (
        <ToolButton
          accessibilityLabel={LIBRARY_COPY.order(
            SORT_DIRECTION_LABELS[parts.field][parts.direction],
          )}
          label={SORT_DIRECTION_LABELS[parts.field][parts.direction]}
          onPress={() => onChange({ sort: reversedSort(settings.sort) })}
        />
      )}
      <Picker
        label={LIBRARY_COPY.view}
        onChoose={(view) => onChange({ view })}
        options={appViewsFor(settings.kind).map((view) => ({
          key: view,
          label: LIBRARY_VIEW_LABELS[view],
        }))}
        value={settings.view}
      />
      {settings.view === LIBRARY_VIEWS.grouped && (
        <Picker
          label={LIBRARY_COPY.groupBy}
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
      line={LIBRARY_COPY.line({
        kind: CONTINUE_WATCHING,
        count: plural({ n: entries.length, ...LIBRARY_COPY.videos }),
      })}
      notice={entries.length === 0 ? LIBRARY_COPY.nothingInProgress : null}
      onBack={() => router.back()}
      onOpen={({ target }) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={library.name}
      toolbar={
        <>
          {toggle}
          <ShuffleButton choices={entries.map((entry) => entry.media)} library={library} />
        </>
      }
      view={LIBRARY_VIEWS.grid}
    />
  )
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
    return listsShows(settings.kind) ? LIBRARY_COPY.gathering.shows : LIBRARY_COPY.gathering.videos
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
      line={LIBRARY_COPY.line({
        kind: KINDS[settings.kind].label,
        count: plural({ n: library.itemCount, ...LIBRARY_COPY.videos }),
      })}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
      search={<SearchField label={LIBRARY_COPY.search(library.name)} search={search} />}
      sections={sections}
      title={library.name}
      toolbar={
        <>
          {toggle}
          <ShuffleButton
            choices={listed === null ? [] : shuffleChoices(listed)}
            library={library}
          />
          <LibraryToolbar onChange={view.change} settings={settings} />
        </>
      }
      view={settings.view}
    />
  )
}

type LibraryPagesProps = {
  session: AppQueries
  library: LibraryRecord
  asked: string
}

/** What a library's pages draw: the mark while its videos in progress are read, then a page. */
const LIBRARY_PAGES_VIEW_KEYS = { loading: 'loading', ...LIBRARY_PAGES } as const

type LibraryPagesViewProps = {
  [LIBRARY_PAGES_VIEW_KEYS.loading]: LoadingProps
  [LIBRARY_PAGES_VIEW_KEYS.continue]: ContinueGridProps
  [LIBRARY_PAGES_VIEW_KEYS.library]: LibraryGridProps
}

const LIBRARY_PAGES_VIEWS = {
  [LIBRARY_PAGES_VIEW_KEYS.loading]: Loading,
  [LIBRARY_PAGES_VIEW_KEYS.continue]: ContinueGrid,
  [LIBRARY_PAGES_VIEW_KEYS.library]: LibraryGrid,
} as const satisfies ViewsOf<LibraryPagesViewProps>

type LibraryPagesViewOfProps = LibraryPagesProps & {
  page: LibraryPage
  isWaiting: boolean
  entries: readonly PosterEntry[]
  toggle: ReactNode
  onBack: () => void
}

const libraryPagesViewOf = ({
  page,
  isWaiting,
  entries,
  toggle,
  onBack,
  ...shown
}: LibraryPagesViewOfProps): ViewOf<LibraryPagesViewProps> => {
  if (isWaiting) {
    return { key: LIBRARY_PAGES_VIEW_KEYS.loading, props: { label: LIBRARY_COPY.opening, onBack } }
  }
  switch (page) {
    case LIBRARY_PAGES.continue:
      return { key: LIBRARY_PAGES_VIEW_KEYS.continue, props: { ...shown, entries, toggle } }
    case LIBRARY_PAGES.library:
      return { key: LIBRARY_PAGES_VIEW_KEYS.library, props: { ...shown, toggle } }
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/**
 * A library's two pages, Continue watching and the library itself, with the one press between
 * them. It opens on Continue watching while anything in it is in progress, so a show is picked
 * up in one press, and on the library otherwise; a search handed over opens the library too.
 */
const LibraryPages = (props: LibraryPagesProps) => {
  const router = useRouter()
  const inProgress = useQuery(props.session.queries.inProgressQuery(props.library.id))
  const [chosen, setChosen] = useState<LibraryPage | null>(null)
  const entries = inProgress.data ?? null
  const isContinuing = props.asked === '' && entries !== null && entries.length > 0
  const page = chosen ?? (isContinuing ? LIBRARY_PAGES.continue : LIBRARY_PAGES.library)
  const view = libraryPagesViewOf({
    ...props,
    page,
    isWaiting: entries === null && inProgress.isPending && chosen === null,
    entries: entries ?? [],
    toggle: <PageToggle onChange={setChosen} page={page} />,
    onBack: () => router.back(),
  })
  return <KeyedView<LibraryPagesViewProps> view={view} views={LIBRARY_PAGES_VIEWS} />
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
      title={LIBRARY_COPY.library}
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

type ReadyLibraryProps = LibraryPagesProps

/** A library of videos once it is known, drawn afresh for each library. */
const ReadyLibrary = (props: ReadyLibraryProps) => (
  <LibraryPages key={props.library.id} {...props} />
)

type ReadyMusicProps = LibraryPagesProps

/** A music library once it is known, drawn afresh for each library. */
const ReadyMusic = (props: ReadyMusicProps) => <MusicPages key={props.library.id} {...props} />

const LIBRARY_VIEW_KEYS = {
  notice: 'notice',
  loading: 'loading',
  ready: 'ready',
  music: 'music',
} as const

type LibraryViewProps = {
  [LIBRARY_VIEW_KEYS.notice]: LibraryNoticeProps
  [LIBRARY_VIEW_KEYS.loading]: LoadingProps
  [LIBRARY_VIEW_KEYS.ready]: ReadyLibraryProps
  [LIBRARY_VIEW_KEYS.music]: ReadyMusicProps
}

const LIBRARY_PAGE_VIEWS = {
  [LIBRARY_VIEW_KEYS.notice]: LibraryNotice,
  [LIBRARY_VIEW_KEYS.loading]: Loading,
  [LIBRARY_VIEW_KEYS.ready]: ReadyLibrary,
  [LIBRARY_VIEW_KEYS.music]: ReadyMusic,
} as const satisfies ViewsOf<LibraryViewProps>

type LibraryViewOfProps = Omit<ServerLibraryProps, 'id'> & {
  page: RouteQuery<LibraryRecord>
  onBack: () => void
}

const noticeView = (notice: string): ViewOf<LibraryViewProps> => ({
  key: LIBRARY_VIEW_KEYS.notice,
  props: { notice },
})

const libraryViewOf = ({
  page,
  session,
  asked,
  onBack,
}: LibraryViewOfProps): ViewOf<LibraryViewProps> => {
  switch (page.state) {
    case ROUTE_STATES.missing:
      return noticeView(LIBRARY_COPY.missing)
    case ROUTE_STATES.error:
      return noticeView(page.message)
    case ROUTE_STATES.loading:
      return { key: LIBRARY_VIEW_KEYS.loading, props: { label: LIBRARY_COPY.opening, onBack } }
    case ROUTE_STATES.ready: {
      const props = { asked, library: page.data, session }
      return listingFor(page.data.settings.kind) === LIBRARY_LISTINGS.albums
        ? { key: LIBRARY_VIEW_KEYS.music, props }
        : { key: LIBRARY_VIEW_KEYS.ready, props }
    }
    default: {
      const unknown: never = page
      return unknown
    }
  }
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
  const view = libraryViewOf({
    page: routeState({ id, query: library }),
    session,
    asked,
    onBack: () => router.back(),
  })
  return <KeyedView<LibraryViewProps> view={view} views={LIBRARY_PAGE_VIEWS} />
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
