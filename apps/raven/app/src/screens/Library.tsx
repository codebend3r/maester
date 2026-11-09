import {
  type Library as LibraryRecord,
  type LibraryKind,
  type LibrarySettings,
  type LibraryView,
  type MediaItem,
  type PosterEntry,
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
import type { IconName } from '@raven/ui/iconDrawings'
import {
  LIBRARY_LOCK_STATES,
  type LibraryLock,
  useSearch,
  KeyedView,
  type ViewOf,
  type ViewsOf,
  lockState,
} from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { MusicPages } from '@/music/MusicPages'
import { hasSagas } from '@/queries/sagaCards'
import { SagasGrid, type SagasGridProps } from '@/screens/LibrarySagas'
import type { ShelfCard } from '@/queries/cards'
import { CONTINUE_WATCHING } from '@/queries/homeShelves'
import { showArtIdsOf } from '@/queries/showArt'
import { useShowArts } from '@/queries/useShowArts'
import { type Listing, continueSectionsOf, librarySectionsOf } from '@/queries/libraryGrid'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { Grid, Loading, Picker, SearchField, ToolButton } from '@/layouts'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'
import { LIBRARY_COPY } from '@/screens/copy'
import { LockedLibrary, type LockedLibraryProps } from '@/screens/LockedLibrary'
import { type PageFrame, type PageTab, PageTools } from '@/screens/PageTools'
import { shuffleDeal } from '@/screens/shuffleDeal'
import { useVideoQueue } from '@/stores/videoQueue'
import type { LoadingProps } from '@/layouts/loadingKit'
import { appViewsFor, useLibraryView } from '@/screens/useLibraryView'
import type { LibraryChoice } from '@/stores/libraryViews'

/**
 * The pages a library opens on: what is being watched in it, for picking up where one left
 * off, the library itself, its listing sorted, laid out and searched, and, in a movie library,
 * its sagas.
 */
const LIBRARY_PAGES = { continue: 'continue', library: 'library', sagas: 'sagas' } as const

type LibraryPage = (typeof LIBRARY_PAGES)[keyof typeof LIBRARY_PAGES]

/** What each page's button says and draws: the web's icons for them. */
const PAGE_TABS = {
  [LIBRARY_PAGES.continue]: { name: CONTINUE_WATCHING, icon: 'history' },
  [LIBRARY_PAGES.library]: { name: LIBRARY_COPY.library, icon: 'libraries' },
  [LIBRARY_PAGES.sagas]: { name: LIBRARY_COPY.sagas, icon: 'covers' },
} as const satisfies Record<LibraryPage, PageTab>

/** What each view's chip draws beside its name: the web's icons for the views. */
const VIEW_ICONS = {
  [LIBRARY_VIEWS.grid]: 'grid',
  [LIBRARY_VIEWS.covers]: 'covers',
  [LIBRARY_VIEWS.list]: 'list',
  [LIBRARY_VIEWS.tiles]: 'tiles',
  [LIBRARY_VIEWS.grouped]: 'grouped',
} as const satisfies Record<LibraryView, IconName>

/** The pages a library has, in the order their buttons stand: Sagas only where files are matched to movies. */
const pagesOf = (kind: LibraryKind): LibraryPage[] =>
  hasSagas(kind)
    ? [LIBRARY_PAGES.continue, LIBRARY_PAGES.library, LIBRARY_PAGES.sagas]
    : [LIBRARY_PAGES.continue, LIBRARY_PAGES.library]

type ShuffleButtonProps = { library: LibraryRecord; choices: readonly MediaItem[] }

/**
 * Shuffle, first after the way to the other page: `choices` dealt into the device's video queue
 * and the first of them played from where it was left, the player's Next and back walking the
 * rest of the deal.
 */
const ShuffleButton = ({ library, choices }: ShuffleButtonProps) => {
  const router = useRouter()
  const start = useVideoQueue((queue) => queue.start)
  return (
    <ToolButton
      accessibilityLabel={LIBRARY_COPY.shuffleLibrary(library.name)}
      icon="shuffle"
      label={LIBRARY_COPY.shuffle}
      onPress={() => {
        const { queue, target } = shuffleDeal({ choices })
        if (target === null) return
        start(queue)
        router.push(hrefOf(target))
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
 * offers them: each the library's type's own, so a sort it cannot use is never offered. Under
 * the thumb only Sort shows its word and its value; the rest are their icons alone.
 */
const LibraryToolbar = ({ settings, onChange }: LibraryToolbarProps) => {
  const parts = sortParts(settings.sort)
  return (
    <>
      <Picker
        icon="ascending"
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
          icon={parts.direction}
          label={SORT_DIRECTION_LABELS[parts.field][parts.direction]}
          onPress={() => onChange({ sort: reversedSort(settings.sort) })}
        />
      )}
      <Picker
        icon={VIEW_ICONS[settings.view]}
        isIconOnly
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
          icon="grouped"
          isIconOnly
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

type LineOfProps = { settings: LibrarySettings; library: LibraryRecord; listed: Listing | null }

/**
 * What a library holds, under its name: a library of shows counts its shows, once they are read,
 * and any other its videos. Its type is not said, since its name says it.
 */
const lineOf = ({ settings, library, listed }: LineOfProps): string | null => {
  if (!listsShows(settings.kind)) return plural({ n: library.itemCount, ...LIBRARY_COPY.videos })
  return listed === null ? null : plural({ n: listed.shows.length, ...LIBRARY_COPY.shows })
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

/** What a library's pages share: the page open, the pages, and the library the toolbar frames. */
type LibraryFrame = PageFrame<LibraryPage>

type ContinueGridProps = {
  session: AppQueries
  library: LibraryRecord
  entries: readonly PosterEntry[]
  frame: LibraryFrame
}

/**
 * A library's Continue watching page: its videos with a saved spot, most recently watched
 * first, wide as Home's shelf draws them, under the library's name and the way to its listing.
 */
const ContinueGrid = ({ session, library, entries, frame }: ContinueGridProps) => {
  const { server, api, queries } = session
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const arts = useShowArts({ queries, ids: showArtIdsOf(entries), pictures })
  const sections = pictures === null ? [] : continueSectionsOf({ entries, arts, ...pictures })
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={plural({ n: entries.length, ...LIBRARY_COPY.inProgress })}
      notice={entries.length === 0 ? LIBRARY_COPY.nothingInProgress : null}
      onBack={() => router.back()}
      onOpen={({ target }) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={library.name}
      toolbar={
        <PageTools frame={frame}>
          <ShuffleButton choices={entries.map((entry) => entry.media)} library={library} />
        </PageTools>
      }
      view={LIBRARY_VIEWS.grid}
    />
  )
}

type LibraryGridProps = {
  session: AppQueries
  library: LibraryRecord
  asked: string
  frame: LibraryFrame
}

/**
 * A library once it is known: its cards, laid out as this device last left it, of those its
 * search finds. The search starts on the one it was opened with.
 */
const LibraryGrid = ({ session, library, asked, frame }: LibraryGridProps) => {
  const { server, api, queries } = session
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
  // Taken once, as the screen opens: render stays pure, and a listing never needs the clock to tick.
  const [now] = useState(() => new Date())

  const sections =
    listed === null || pictures === null
      ? []
      : librarySectionsOf({ settings, listing: listed, now, ...pictures })
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
      line={lineOf({ settings, library, listed })}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
      search={<SearchField label={LIBRARY_COPY.search(library.name)} search={search} />}
      sections={sections}
      title={library.name}
      toolbar={
        <PageTools frame={frame}>
          <ShuffleButton
            choices={listed === null ? [] : shuffleChoices(listed)}
            library={library}
          />
          <LibraryToolbar onChange={view.change} settings={settings} />
        </PageTools>
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
  [LIBRARY_PAGES_VIEW_KEYS.sagas]: SagasGridProps<LibraryPage>
}

const LIBRARY_PAGES_VIEWS = {
  [LIBRARY_PAGES_VIEW_KEYS.loading]: Loading,
  [LIBRARY_PAGES_VIEW_KEYS.continue]: ContinueGrid,
  [LIBRARY_PAGES_VIEW_KEYS.library]: LibraryGrid,
  [LIBRARY_PAGES_VIEW_KEYS.sagas]: SagasGrid,
} as const satisfies ViewsOf<LibraryPagesViewProps>

type LibraryPagesViewOfProps = LibraryPagesProps & {
  frame: LibraryFrame
  isWaiting: boolean
  entries: readonly PosterEntry[]
  onBack: () => void
}

const libraryPagesViewOf = ({
  frame,
  isWaiting,
  entries,
  onBack,
  ...shown
}: LibraryPagesViewOfProps): ViewOf<LibraryPagesViewProps> => {
  if (isWaiting) {
    return { key: LIBRARY_PAGES_VIEW_KEYS.loading, props: { label: LIBRARY_COPY.opening, onBack } }
  }
  switch (frame.page) {
    case LIBRARY_PAGES.continue:
      return { key: LIBRARY_PAGES_VIEW_KEYS.continue, props: { ...shown, entries, frame } }
    case LIBRARY_PAGES.library:
      return { key: LIBRARY_PAGES_VIEW_KEYS.library, props: { ...shown, frame } }
    case LIBRARY_PAGES.sagas:
      return {
        key: LIBRARY_PAGES_VIEW_KEYS.sagas,
        props: { session: shown.session, library: shown.library, frame },
      }
    default: {
      const unknown: never = frame.page
      return unknown
    }
  }
}

/**
 * A library's pages, Continue watching, the library itself and, in a movie library, its Sagas,
 * with a press to each of the others. It opens on Continue watching while anything in it is in progress, so a show is picked
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
    frame: {
      page,
      pages: pagesOf(props.library.settings.kind),
      tabs: PAGE_TABS,
      onChange: setChosen,
      library: props.library,
      api: props.session.api,
    },
    isWaiting: entries === null && inProgress.isPending && chosen === null,
    entries: entries ?? [],
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
  locked: 'locked',
  ready: 'ready',
  music: 'music',
} as const

type LibraryViewProps = {
  [LIBRARY_VIEW_KEYS.notice]: LibraryNoticeProps
  [LIBRARY_VIEW_KEYS.loading]: LoadingProps
  [LIBRARY_VIEW_KEYS.locked]: LockedLibraryProps
  [LIBRARY_VIEW_KEYS.ready]: ReadyLibraryProps
  [LIBRARY_VIEW_KEYS.music]: ReadyMusicProps
}

const LIBRARY_PAGE_VIEWS = {
  [LIBRARY_VIEW_KEYS.notice]: LibraryNotice,
  [LIBRARY_VIEW_KEYS.loading]: Loading,
  [LIBRARY_VIEW_KEYS.locked]: LockedLibrary,
  [LIBRARY_VIEW_KEYS.ready]: ReadyLibrary,
  [LIBRARY_VIEW_KEYS.music]: ReadyMusic,
} as const satisfies ViewsOf<LibraryViewProps>

type LibraryViewOfProps = Omit<ServerLibraryProps, 'id'> & {
  page: RouteQuery<LibraryRecord>
  /** Where the library stands with the PIN, once it is known. */
  lock: LibraryLock
  onBack: () => void
}

type KnownLibraryViewOfProps = Omit<LibraryViewOfProps, 'page'> & { library: LibraryRecord }

/**
 * A known library's view: the lock in place of its pages while it is shut here, the mark while
 * the server has yet to say, and its pages, a music library's its own, once it is open.
 */
const knownLibraryViewOf = ({
  library,
  lock,
  session,
  asked,
  onBack,
}: KnownLibraryViewOfProps): ViewOf<LibraryViewProps> => {
  switch (lock.state) {
    case LIBRARY_LOCK_STATES.shut:
      return {
        key: LIBRARY_VIEW_KEYS.locked,
        props: { session, library, canUnlock: lock.canUnlock },
      }
    case LIBRARY_LOCK_STATES.checking:
      return { key: LIBRARY_VIEW_KEYS.loading, props: { label: LIBRARY_COPY.opening, onBack } }
    case LIBRARY_LOCK_STATES.open: {
      const props = { asked, library, session }
      return listingFor(library.settings.kind) === LIBRARY_LISTINGS.albums
        ? { key: LIBRARY_VIEW_KEYS.music, props }
        : { key: LIBRARY_VIEW_KEYS.ready, props }
    }
    default: {
      const unknown: never = lock
      return unknown
    }
  }
}

const noticeView = (notice: string): ViewOf<LibraryViewProps> => ({
  key: LIBRARY_VIEW_KEYS.notice,
  props: { notice },
})

const libraryViewOf = ({
  page,
  lock,
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
    case ROUTE_STATES.ready:
      return knownLibraryViewOf({ library: page.data, lock, session, asked, onBack })
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
  // The lock is asked for only when the library is locked, as the web's `useLibraryLock` does.
  const isLocked = library.data?.settings.locked ?? false
  const lock = useQuery({ ...queries.lockQuery, enabled: isLocked })
  const view = libraryViewOf({
    page: routeState({ id, query: library }),
    lock: lockState({ isLocked, lock: lock.data }),
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
