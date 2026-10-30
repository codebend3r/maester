import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  type AiSuggestion,
  emptyListingMessage,
  finishedNote,
  isScanning,
  ITEM_TYPES,
  listsShows,
  jumpScale,
  type Library,
  type LibrarySettings,
  matchTypeFor,
  type MediaItem,
  METADATA_SERVICE_STATES,
  type PosterEntry,
  queueLink,
  sagaEntryKey,
  sagaTargets,
  SHUFFLE_LENGTH,
  showEntryKey,
  shuffled,
  type UnmatchedFile,
  WATCH_TARGET_KINDS,
  watchLink,
} from '@raven/core'
import { type ComponentType, type ReactNode, useDeferredValue, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ButtonLink } from '@raven/ui'
import { HISTORY_SHOWS, KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { Duplicates } from '@/components/Duplicates/Duplicates'
import { JumpPicker } from '@/components/JumpPicker/JumpPicker'
import { LibraryToolbar, ShowLevelPicker } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { SagaDecks } from '@/components/SagaDeck/SagaDeck'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import {
  type SelectionEntry,
  SelectionScope,
  mediaEntryOf,
  sourceOf,
} from '@/components/SelectionScope/SelectionScope'
import { Loading } from '@/components/Skeleton/Skeleton'
import { Spinner } from '@/components/Spinner/Spinner'
import { SuggestedMovies } from '@/components/SuggestedMovies/SuggestedMovies'
import { UnmatchedShows } from '@/components/UnmatchedShows/UnmatchedShows'
import { cannotManageNote, useManagement } from '@/lib/management'
import {
  duplicatesQuery,
  historyQuery,
  inProgressQuery,
  libraryFavouritesQuery,
  metadataHealthQuery,
  sagasQuery,
  unmatchedQuery,
} from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { LibraryListing, LibraryListingSkeleton } from '@/pages/LibraryPage/LibraryViews'
import { AlbumsSection, ArtistsSection, PlaylistsSection } from '@/pages/LibraryPage/MusicSections'
import { SelectableCards } from '@/pages/LibraryPage/SelectableCards'
import {
  LISTING_STATES,
  type ListingState,
  NOTHING_LISTED,
  playQueue,
} from '@/pages/LibraryPage/libraryShape'
import {
  FINISHED_LIMIT,
  LIBRARY_SECTIONS,
  type LibrarySection,
} from '@/pages/LibraryPage/librarySections'
import { useAiLookupsDone } from '@/pages/LibraryPage/useAiLookupsDone'
import { useLibraryListing } from '@/pages/LibraryPage/useLibraryListing'
import { useLibraryView } from '@/pages/LibraryPage/useLibraryView'
import { POLL_MS, anyPending, useMatchingPassDone } from '@/pages/LibraryPage/useMatchingPassDone'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { SHOW_LEVELS, type ShowLevel } from '@/lib/showLevels'

/** A tab's `empty`: `message` when its list has nothing in it. */
const whenEmpty =
  (message: string) =>
  (list: readonly unknown[]): string | null =>
    list.length === 0 ? message : null

type SectionBodyProps<T> = {
  query: UseQueryResult<T>
  shape: ReactNode
  empty: (data: T) => string | null
  children: (data: T) => ReactNode
}

const BODY_VIEW_KEYS = {
  failed: 'failed',
  pending: 'pending',
  empty: 'empty',
  ready: 'ready',
} as const

type FailedProps = { error: Error }

/** Why what a tab lists could not be read. */
const Failed = ({ error }: FailedProps) => (
  <p className={styles.message} role="alert">
    {error.message}
  </p>
)

type ShapeProps = { shape: ReactNode }

const Shape = ({ shape }: ShapeProps) => <Loading label={COMMON_COPY.loading}>{shape}</Loading>

type EmptyProps = { message: string }

const Empty = ({ message }: EmptyProps) => <p className={styles.message}>{message}</p>

type ContentProps = { content: ReactNode }

const Content = ({ content }: ContentProps) => content

type BodyViewsProps = {
  [BODY_VIEW_KEYS.failed]: FailedProps
  [BODY_VIEW_KEYS.pending]: ShapeProps
  [BODY_VIEW_KEYS.empty]: EmptyProps
  [BODY_VIEW_KEYS.ready]: ContentProps
}

const BODY_VIEWS = {
  [BODY_VIEW_KEYS.failed]: Failed,
  [BODY_VIEW_KEYS.pending]: Shape,
  [BODY_VIEW_KEYS.empty]: Empty,
  [BODY_VIEW_KEYS.ready]: Content,
} as const satisfies ViewsOf<BodyViewsProps>

type SectionBodyViewProps<T> = SectionBodyProps<T>

/** Which view a tab's body shows, as its query stands. */
const sectionBodyView = <T,>({
  query,
  shape,
  empty,
  children,
}: SectionBodyViewProps<T>): ViewOf<BodyViewsProps> => {
  if (query.isError) return { key: BODY_VIEW_KEYS.failed, props: { error: query.error } }
  if (query.isPending) return { key: BODY_VIEW_KEYS.pending, props: { shape } }
  const message = empty(query.data)
  if (message != null) return { key: BODY_VIEW_KEYS.empty, props: { message } }
  return { key: BODY_VIEW_KEYS.ready, props: { content: children(query.data) } }
}

/**
 * A tab's body: its failure, `shape` while it loads, the line `empty` gives
 * for what came back, if any, else its content.
 */
const SectionBody = <T,>(props: SectionBodyProps<T>) => (
  <KeyedView<BodyViewsProps> views={BODY_VIEWS} view={sectionBodyView(props)} />
)

type EntryGridProps = { library: Library; entries: PosterEntry[] }

/**
 * Videos as the library lays its cards out: posters where it is matched (an
 * episode wears its season's), frame grabs where it is not.
 */
const EntryGrid = ({ library, entries }: EntryGridProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  const posters = new Map(entries.map(({ media, poster }) => [media.id, poster]))
  return (
    <SelectableCards entries={entries.map(({ media }) => mediaEntryOf(media))}>
      <MediaGrid
        items={entries.map((entry) => entry.media)}
        posters={matchType != null}
        posterOf={(media) => posters.get(media.id) ?? null}
        matchType={matchType}
        ratingsSource={library.settings.ratingsSource}
      />
    </SelectableCards>
  )
}

type ListingBodyProps = {
  listing: ListingState
  settings: LibrarySettings
  level: ShowLevel
  empty: string | null
}

const LISTING_VIEW_KEYS = {
  pending: 'pending',
  failed: 'failed',
  empty: 'empty',
  listed: 'listed',
} as const

type ListingViewsProps = {
  [LISTING_VIEW_KEYS.pending]: Parameters<typeof LibraryListingSkeleton>[0]
  [LISTING_VIEW_KEYS.failed]: FailedProps
  [LISTING_VIEW_KEYS.empty]: EmptyProps
  [LISTING_VIEW_KEYS.listed]: Parameters<typeof LibraryListing>[0]
}

const LISTING_VIEWS = {
  [LISTING_VIEW_KEYS.pending]: LibraryListingSkeleton,
  [LISTING_VIEW_KEYS.failed]: Failed,
  [LISTING_VIEW_KEYS.empty]: Empty,
  [LISTING_VIEW_KEYS.listed]: LibraryListing,
} as const satisfies ViewsOf<ListingViewsProps>

type ListingViewProps = ListingBodyProps

/** Which view the listing shows as it stands. */
const listingView = ({
  listing,
  settings,
  level,
  empty,
}: ListingViewProps): ViewOf<ListingViewsProps> => {
  if (listing.state === LISTING_STATES.pending)
    return { key: LISTING_VIEW_KEYS.pending, props: { settings } }
  if (listing.state === LISTING_STATES.failed)
    return { key: LISTING_VIEW_KEYS.failed, props: { error: listing.error } }
  if (empty) return { key: LISTING_VIEW_KEYS.empty, props: { message: empty } }
  return {
    key: LISTING_VIEW_KEYS.listed,
    props: {
      settings,
      level,
      shows: listing.shows,
      seasons: listing.seasons,
      files: listing.files,
    },
  }
}

/** The listing as it stands: its shape on its way, why it could not be read, why it is empty, or itself. */
const ListingBody = (props: ListingBodyProps) => (
  <KeyedView<ListingViewsProps> views={LISTING_VIEWS} view={listingView(props)} />
)

type SameLayoutProps = { a: LibrarySettings; b: LibrarySettings }

/** Whether two settings lay a listing out the same way. */
const sameLayout = ({ a, b }: SameLayoutProps): boolean =>
  a.view === b.view && a.sort === b.sort && a.groupBy === b.groupBy

type AllSectionProps = { library: Library }

/**
 * Every video or show in the library, searched, sorted and laid out as it
 * was left, with Play and Shuffle, and a strip down the side that jumps
 * through the order. The strip scrolls within this tab's cards.
 */
const AllSection = ({ library }: AllSectionProps) => {
  const cards = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const view = useLibraryView({ library })
  const [level, setLevel] = useState<ShowLevel>(SHOW_LEVELS.shows)
  // The listing follows a change of view once it can lay itself out, the old one standing till then.
  const settings = useDeferredValue(view.settings)
  const isChanging = !sameLayout({ a: settings, b: view.settings })
  const scanning = isScanning(library.scan)
  const listing = useLibraryListing({
    libraryId: library.id,
    settings,
    level,
    search: view.query,
    seed: view.seed,
    scanning,
  })
  const listed = listing.state === LISTING_STATES.listed ? listing : NOTHING_LISTED
  const queue = playQueue({ settings, listing: listed })
  // The strip down the side follows the order: letters for titles, steps of
  // the value sorted by for the rest, none for a random order.
  const scale = jumpScale({
    sort: settings.sort,
    files: listed.files,
    shows: listed.shows,
    source: settings.ratingsSource,
  })
  const empty =
    listing.state === LISTING_STATES.listed
      ? emptyListingMessage({
          isEmpty:
            listed.shows.length === 0 && listed.seasons.length === 0 && listed.files.length === 0,
          query: view.query,
          isScanning: scanning,
        })
      : null

  // The item rides along in router state, as a card click hands it over, so
  // the player starts without fetching it again.
  const watch = (item: MediaItem | undefined) => {
    if (!item) return
    const link = watchLink({ media: item })
    navigate(link.to, { state: link.state })
  }

  // Every card the listing holds, those in a closed bucket too.
  const entries = [
    ...listed.shows.map((entry): SelectionEntry => [
      showEntryKey(entry.show),
      [{ kind: WATCH_TARGET_KINDS.item, id: entry.show.id, libraryId: library.id }],
    ]),
    ...listed.files.map(mediaEntryOf),
  ]

  return (
    <SelectionScope {...sourceOf(entries)}>
      <div ref={cards} className={scale ? `${styles.section} ${styles.withJump}` : styles.section}>
        <LibraryToolbar
          name={library.name}
          search={view.search}
          settings={view.shown}
          onChange={view.change}
          playable={queue.playable}
          onPlay={() => watch(queue.first())}
          onShuffle={() => {
            const link = queueLink({ queue: queue.shuffled() })
            if (link) navigate(link.to, { state: link.state })
          }}
        >
          {listsShows(library.settings.kind) && (
            <ShowLevelPicker level={level} onChange={setLevel} />
          )}
        </LibraryToolbar>

        {view.saveError && (
          <p className={styles.message} role="alert">
            {LIBRARY_COPY.saveFailed(view.saveError.message)}
          </p>
        )}

        {scale && !empty && <JumpPicker scale={scale} scope={cards} />}

        <div className={styles.listing} aria-busy={isChanging}>
          <div
            className={isChanging ? `${styles.listingBody} ${styles.changing}` : styles.listingBody}
          >
            <ListingBody listing={listing} settings={settings} level={level} empty={empty} />
          </div>
          {isChanging && (
            <output className={styles.switching}>
              <Spinner />
              {LIBRARY_COPY.changingView}
            </output>
          )}
        </div>

        <SelectionBar />
      </div>
    </SelectionScope>
  )
}

type InProgressSectionProps = { library: Library }

/**
 * What was left partway through, the most recently watched first, under
 * Play, which picks them up in that order, and Shuffle.
 */
const InProgressSection = ({ library }: InProgressSectionProps) => {
  const query = useQuery(inProgressQuery(library.id))
  const navigate = useNavigate()
  const media = query.data?.map((entry) => entry.media) ?? []
  const play = (queue: MediaItem[]) => {
    const link = queueLink({ queue: queue.slice(0, SHUFFLE_LENGTH) })
    if (link) navigate(link.to, { state: link.state })
  }
  return (
    <div className={styles.section}>
      <div className={styles.playRow}>
        <PlayButtons
          playable={media.length > 0}
          onPlay={() => play(media)}
          onShuffle={() => play(shuffled({ items: media }))}
        />
      </div>
      <SectionBody
        query={query}
        shape={<MediaGridSkeleton posters={matchTypeFor(library.settings.kind) != null} />}
        empty={whenEmpty(
          library.settings.saveProgress
            ? LIBRARY_COPY.inProgressEmpty(library.name)
            : LIBRARY_COPY.inProgressUnsaved(library.name),
        )}
      >
        {(entries) => <EntryGrid library={library} entries={entries} />}
      </SectionBody>
    </div>
  )
}

type FavouritesSectionProps = { library: Library }

/** The library's favourites, most recently marked first. */
const FavouritesSection = ({ library }: FavouritesSectionProps) => {
  const query = useQuery(libraryFavouritesQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton posters={matchTypeFor(library.settings.kind) != null} />}
      empty={whenEmpty(LIBRARY_COPY.favouritesEmpty(library.name))}
    >
      {(entries) => <EntryGrid library={library} entries={entries} />}
    </SectionBody>
  )
}

type SagasSectionProps = { library: Library }

/**
 * The library's movies gathered by the TMDB collection they belong to, by
 * name, each saga a deck of its posters that opens its own page.
 */
const SagasSection = ({ library }: SagasSectionProps) => {
  const query = useQuery(sagasQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton posters />}
      empty={whenEmpty(LIBRARY_COPY.sagasEmpty(library.name))}
    >
      {(sagas) => (
        <SelectableCards
          entries={sagas.map((saga) => [
            sagaEntryKey(saga),
            sagaTargets({ saga, libraryId: library.id }),
          ])}
        >
          <SagaDecks libraryId={library.id} sagas={sagas} />
        </SelectableCards>
      )}
    </SectionBody>
  )
}

/** What the AI lookup suggests for a file, read off the Not matched listing. */
const suggestionsIn =
  (files: readonly UnmatchedFile[]) =>
  (file: MediaItem): AiSuggestion | null =>
    files.find((each) => each.id === file.id)?.aiSuggestion ?? null

type NotMatchedHintProps = {
  matchType: ReturnType<typeof matchTypeFor>
  management: ReturnType<typeof useManagement>
}

/** What the Not matched tab says to do about its files: Fix match, once the viewer may manage. */
const notMatchedHint = ({ matchType, management }: NotMatchedHintProps): string => {
  const title = matchType ?? LIBRARY_COPY.title
  if (!management.canManage) {
    return cannotManageNote({
      mode: management.mode,
      action: LIBRARY_COPY.pointAt(title),
    })
  }
  if (matchType === ITEM_TYPES.show) {
    return LIBRARY_COPY.fixShowMatch
  }
  return LIBRARY_COPY.fixFileMatch(title)
}

const NOT_MATCHED_LAYOUTS = { shows: 'shows', files: 'files' } as const

type NotMatchedLayout = (typeof NOT_MATCHED_LAYOUTS)[keyof typeof NOT_MATCHED_LAYOUTS]

/** A TV library's files not matched are gathered by the show their folder is for; any other's are cards. */
const notMatchedLayout = (matchType: ReturnType<typeof matchTypeFor>): NotMatchedLayout =>
  matchType === ITEM_TYPES.show ? NOT_MATCHED_LAYOUTS.shows : NOT_MATCHED_LAYOUTS.files

const NOT_MATCHED_SHAPES = {
  [NOT_MATCHED_LAYOUTS.shows]: MediaTilesSkeleton,
  [NOT_MATCHED_LAYOUTS.files]: MediaGridSkeleton,
} as const satisfies Record<NotMatchedLayout, ComponentType>

type NotMatchedShapeProps = { matchType: ReturnType<typeof matchTypeFor> }

const NotMatchedShape = ({ matchType }: NotMatchedShapeProps) => {
  const Bones = NOT_MATCHED_SHAPES[notMatchedLayout(matchType)]
  return <Bones />
}

type NotMatchedFilesProps = { library: Library; files: UnmatchedFile[] }

type UnmatchedShowFilesProps = NotMatchedFilesProps

/** A TV library's files not matched, by the show their folder is for. */
const UnmatchedShowFiles = ({ library, files }: UnmatchedShowFilesProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  return (
    <UnmatchedShows
      files={files}
      suggestionOf={suggestionsIn(files)}
      renderFiles={(group) => (
        <MediaGrid
          items={group}
          matchType={matchType}
          ratingsSource={library.settings.ratingsSource}
        />
      )}
    />
  )
}

type UnmatchedFileCardsProps = NotMatchedFilesProps

/** Any other library's files not matched, with the movies the AI lookup suggests. */
const UnmatchedFileCards = ({ library, files }: UnmatchedFileCardsProps) => (
  <>
    <SuggestedMovies files={files} libraryId={library.id} />
    <MediaGrid
      items={files}
      matchType={matchTypeFor(library.settings.kind)}
      ratingsSource={library.settings.ratingsSource}
    />
  </>
)

const NOT_MATCHED_FILES = {
  [NOT_MATCHED_LAYOUTS.shows]: UnmatchedShowFiles,
  [NOT_MATCHED_LAYOUTS.files]: UnmatchedFileCards,
} as const satisfies Record<NotMatchedLayout, ComponentType<NotMatchedFilesProps>>

const NotMatchedFiles = ({ library, files }: NotMatchedFilesProps) => {
  const Files = NOT_MATCHED_FILES[notMatchedLayout(matchTypeFor(library.settings.kind))]
  return <Files library={library} files={files} />
}

type NotMatchedSectionProps = { library: Library }

/**
 * The files no movie or show was found for, each with Fix match in its menu,
 * and what the AI lookup suggests where it was not sure. While TMDB answers,
 * the tab keeps reading again until none is pending, then reads the library
 * again for its count of files not matched. The lookups run after that, so
 * once they end, the tab reads both again.
 */
const NotMatchedSection = ({ library }: NotMatchedSectionProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  const metadata = useQuery(metadataHealthQuery)
  const canMatch = metadata.data?.tmdb === METADATA_SERVICE_STATES.ok
  const management = useManagement()
  const query = useQuery({
    ...unmatchedQuery(library.id),
    refetchInterval: (current) =>
      canMatch && anyPending(current.state.data ?? []) ? POLL_MS : false,
  })
  useMatchingPassDone({ libraryId: library.id, files: query.data ?? [] })
  useAiLookupsDone({ libraryId: library.id, files: query.data ?? [] })
  return (
    <SectionBody
      query={query}
      shape={<NotMatchedShape matchType={matchType} />}
      empty={whenEmpty(LIBRARY_COPY.allMatched(library.name))}
    >
      {(files) => (
        <>
          <p className={styles.message}>{notMatchedHint({ matchType, management })}</p>
          <NotMatchedFiles files={files} library={library} />
        </>
      )}
    </SectionBody>
  )
}

type DuplicatesSectionProps = { library: Library }

/**
 * The movies holding more than one file on their card, each to split
 * apart, and the movies already split, each to put back together.
 */
const DuplicatesSection = ({ library }: DuplicatesSectionProps) => {
  const query = useQuery(duplicatesQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton posters />}
      empty={whenEmpty(LIBRARY_COPY.duplicatesEmpty(library.name))}
    >
      {(listing) => <Duplicates library={library} listing={listing} />}
    </SectionBody>
  )
}

type FinishedSectionProps = { library: Library }

/** What was watched to the end most recently, with a way to the whole history. */
const FinishedSection = ({ library }: FinishedSectionProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  const query = useQuery(
    historyQuery({ libraryId: library.id, show: HISTORY_SHOWS.watched, limit: FINISHED_LIMIT }),
  )
  return (
    <SectionBody
      query={query}
      shape={<MediaTilesSkeleton />}
      empty={whenEmpty(
        LIBRARY_COPY.finishedEmpty({
          name: library.name,
          percent: library.settings.watchedPercent,
        }),
      )}
    >
      {(entries) => {
        const notes = new Map(entries.map((entry) => [entry.media.id, finishedNote({ entry })]))
        return (
          <SelectableCards entries={entries.map(({ media }) => mediaEntryOf(media))}>
            <MediaTiles
              items={entries.map((entry) => entry.media)}
              note={(media) => notes.get(media.id) ?? null}
              posters={matchType === ITEM_TYPES.movie}
              matchType={matchType}
            />
            <ButtonLink
              to={`/libraries/${library.id}/history`}
              icon="history"
              className={styles.more}
            >
              {LIBRARY_COPY.fullHistory}
            </ButtonLink>
          </SelectableCards>
        )
      }}
    </SectionBody>
  )
}

type SectionProps = { library: Library }

/** Each tab's content. */
const SECTION_VIEWS = {
  [LIBRARY_SECTIONS.all]: AllSection,
  [LIBRARY_SECTIONS.albums]: AlbumsSection,
  [LIBRARY_SECTIONS.artists]: ArtistsSection,
  [LIBRARY_SECTIONS.playlists]: PlaylistsSection,
  [LIBRARY_SECTIONS.inProgress]: InProgressSection,
  [LIBRARY_SECTIONS.favourites]: FavouritesSection,
  [LIBRARY_SECTIONS.sagas]: SagasSection,
  [LIBRARY_SECTIONS.notMatched]: NotMatchedSection,
  [LIBRARY_SECTIONS.duplicates]: DuplicatesSection,
  [LIBRARY_SECTIONS.finished]: FinishedSection,
} as const satisfies Record<LibrarySection, ComponentType<SectionProps>>

type SectionViewProps = {
  library: Library
  section: LibrarySection
}

/** The open tab's content. */
export const SectionView = ({ library, section }: SectionViewProps) => {
  const View = SECTION_VIEWS[section]
  return <View library={library} />
}
