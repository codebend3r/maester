import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  type Library,
  type MediaItem,
  type PosterEntry,
  isScanning,
  matchTypeFor,
} from '@raven/core'
import { type ReactNode, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { Duplicates } from '@/components/Duplicates/Duplicates'
import { JumpPicker } from '@/components/JumpPicker/JumpPicker'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { SagaDecks } from '@/components/SagaDeck/SagaDeck'
import { Loading } from '@/components/Skeleton/Skeleton'
import { finishedNote } from '@/lib/history'
import { watchLink } from '@/lib/itemLinks'
import { jumpScale } from '@/lib/jumpScale'
import {
  duplicatesQuery,
  historyQuery,
  inProgressQuery,
  libraryFavouritesQuery,
  metadataHealthQuery,
  sagasQuery,
  unmatchedQuery,
} from '@/lib/queries'
import { LibraryListing, LibraryListingSkeleton } from '@/pages/LibraryPage/LibraryViews'
import { playQueue } from '@/pages/LibraryPage/libraryShape'
import type { LibrarySection } from '@/pages/LibraryPage/librarySections'
import { useLibraryListing } from '@/pages/LibraryPage/useLibraryListing'
import { useLibraryView } from '@/pages/LibraryPage/useLibraryView'
import { POLL_MS, anyPending, useMatchingPassDone } from '@/pages/LibraryPage/useMatchingPassDone'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** How many finished videos the tab shows; the History page has the rest. */
const FINISHED_LIMIT = 48

/** What the page says in place of a listing with nothing in it, or null while there is something. */
const emptyMessage = ({
  loaded,
  empty,
  query,
  scanning,
}: {
  loaded: boolean
  empty: boolean
  query: string
  scanning: boolean
}): string | null => {
  if (!loaded || !empty) return null
  if (query) return `Nothing here matches "${query}".`
  if (scanning) return 'Looking through the folders. Videos appear here as they are found.'
  return 'No videos in these folders yet. Check the paths, or add a folder that holds videos.'
}

/** A tab's `empty`: `message` when its list has nothing in it. */
const whenEmpty =
  (message: string) =>
  (list: readonly unknown[]): string | null =>
    list.length === 0 ? message : null

/**
 * A tab's body: its failure, `shape` while it loads, the line `empty` gives
 * for what came back, if any, else its content.
 */
const SectionBody = <T,>({
  query,
  shape,
  empty,
  children,
}: {
  query: UseQueryResult<T>
  shape: ReactNode
  empty: (data: T) => string | null
  children: (data: T) => ReactNode
}) => {
  if (query.isError) {
    return (
      <p className={styles.message} role="alert">
        {query.error.message}
      </p>
    )
  }
  if (query.isPending) return <Loading label="Loading">{shape}</Loading>
  const message = empty(query.data)
  if (message != null) return <p className={styles.message}>{message}</p>
  return children(query.data)
}

/**
 * Videos as the library lays its cards out: posters where it is matched (an
 * episode wears its season's), frame grabs where it is not.
 */
const EntryGrid = ({ library, entries }: { library: Library; entries: PosterEntry[] }) => {
  const matchType = matchTypeFor(library.settings.kind)
  const posters = new Map(entries.map(({ media, poster }) => [media.id, poster]))
  return (
    <MediaGrid
      items={entries.map((entry) => entry.media)}
      posters={matchType != null}
      posterOf={(media) => posters.get(media.id) ?? null}
      matchType={matchType}
      ratingsSource={library.settings.ratingsSource}
    />
  )
}

/** `EntryGrid` while its entries are on their way. */
const EntryGridSkeleton = ({ library }: { library: Library }) => (
  <MediaGridSkeleton posters={matchTypeFor(library.settings.kind) != null} />
)

/**
 * Every video or show in the library, searched, sorted and laid out as it
 * was left, with Play and Shuffle, and a strip down the side that jumps
 * through the order. The strip scrolls within this tab's cards.
 */
const AllSection = ({ library }: { library: Library }) => {
  const cards = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const view = useLibraryView({ library })
  const { settings } = view
  const scanning = isScanning(library.scan)
  const listing = useLibraryListing({
    libraryId: library.id,
    settings,
    search: view.query,
    seed: view.seed,
    scanning,
  })
  const queue = playQueue({ settings, listing })
  // The strip down the side follows the order: letters for titles, steps of
  // the value sorted by for the rest, none for a random order.
  const scale = jumpScale({
    sort: settings.sort,
    files: listing.files,
    shows: listing.shows,
    source: settings.ratingsSource,
  })
  const isListed = !listing.pending && listing.error == null
  const empty = emptyMessage({
    loaded: isListed,
    empty: listing.shows.length === 0 && listing.files.length === 0,
    query: view.query,
    scanning,
  })

  // The item rides along in router state, as a card click hands it over, so
  // the player starts without fetching it again.
  const watch = (item: MediaItem | undefined) => {
    if (!item) return
    const link = watchLink(item)
    navigate(link.to, { state: link.state })
  }

  return (
    <div ref={cards} className={scale ? `${styles.section} ${styles.withJump}` : styles.section}>
      <LibraryToolbar
        name={library.name}
        search={view.search}
        onSearch={view.setSearch}
        settings={settings}
        onChange={view.change}
        playable={queue.playable}
        onPlay={() => watch(queue.first())}
        onShuffle={() => watch(queue.random())}
      />

      {view.saveError && (
        <p className={styles.message} role="alert">
          Could not save how this library is shown: {view.saveError.message}
        </p>
      )}

      {scale && !empty && <JumpPicker scale={scale} scope={cards} />}

      {listing.pending && <LibraryListingSkeleton settings={settings} />}
      {listing.error && (
        <p className={styles.message} role="alert">
          {listing.error.message}
        </p>
      )}
      {empty && <p className={styles.message}>{empty}</p>}
      {isListed && !empty && (
        <LibraryListing settings={settings} shows={listing.shows} files={listing.files} />
      )}
    </div>
  )
}

/** What was left partway through, the most recently watched first. */
const InProgressSection = ({ library }: { library: Library }) => {
  const query = useQuery(inProgressQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<EntryGridSkeleton library={library} />}
      empty={whenEmpty(
        library.settings.saveProgress
          ? `Nothing in progress in ${library.name}. A video left partway through waits here.`
          : `${library.name} does not save where videos stop, so nothing waits here. Edit can turn that on.`,
      )}
    >
      {(entries) => <EntryGrid library={library} entries={entries} />}
    </SectionBody>
  )
}

/** The library's favourites, most recently marked first. */
const FavouritesSection = ({ library }: { library: Library }) => {
  const query = useQuery(libraryFavouritesQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<EntryGridSkeleton library={library} />}
      empty={whenEmpty(
        `No favourites in ${library.name} yet. Open a video's menu, from the button in its corner or a right click, and choose Favourite.`,
      )}
    >
      {(entries) => <EntryGrid library={library} entries={entries} />}
    </SectionBody>
  )
}

/**
 * The library's movies gathered by the TMDB collection they belong to, by
 * name, each saga a deck of its posters that opens its own page.
 */
const SagasSection = ({ library }: { library: Library }) => {
  const query = useQuery(sagasQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton posters />}
      empty={whenEmpty(
        `No sagas in ${library.name} yet. One shows here once two movies or more from the same TMDB collection are in the library.`,
      )}
    >
      {(sagas) => <SagaDecks libraryId={library.id} sagas={sagas} />}
    </SectionBody>
  )
}

/**
 * The files no movie or show was found for, each with Fix match in its menu.
 * While TMDB answers, the tab keeps reading again until none is pending,
 * then reads the library again for its count of files not matched.
 */
const NotMatchedSection = ({ library }: { library: Library }) => {
  const matchType = matchTypeFor(library.settings.kind)
  const metadata = useQuery(metadataHealthQuery)
  const canMatch = metadata.data?.tmdb === 'ok'
  const query = useQuery({
    ...unmatchedQuery(library.id),
    refetchInterval: (current) =>
      canMatch && anyPending(current.state.data ?? []) ? POLL_MS : false,
  })
  useMatchingPassDone({ libraryId: library.id, files: query.data ?? [] })
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton />}
      empty={whenEmpty(`Every file in ${library.name} is matched.`)}
    >
      {(files) => (
        <>
          <p className={styles.message}>
            Open a file's menu and choose Fix match to point it at the right {matchType ?? 'title'}.
          </p>
          <MediaGrid
            items={files}
            matchType={matchType}
            ratingsSource={library.settings.ratingsSource}
          />
        </>
      )}
    </SectionBody>
  )
}

/**
 * The movies holding more than one file on their card, each to split
 * apart, and the movies already split, each to put back together.
 */
const DuplicatesSection = ({ library }: { library: Library }) => {
  const query = useQuery(duplicatesQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton posters />}
      empty={whenEmpty(`No movie in ${library.name} has more than one file.`)}
    >
      {(listing) => <Duplicates library={library} listing={listing} />}
    </SectionBody>
  )
}

/** What was watched to the end most recently, with a way to the whole history. */
const FinishedSection = ({ library }: { library: Library }) => {
  const matchType = matchTypeFor(library.settings.kind)
  const query = useQuery(
    historyQuery({ libraryId: library.id, show: 'watched', limit: FINISHED_LIMIT }),
  )
  return (
    <SectionBody
      query={query}
      shape={<MediaTilesSkeleton />}
      empty={whenEmpty(
        `Nothing finished in ${library.name} yet. A video counts once playback gets ${library.settings.watchedPercent}% of the way through.`,
      )}
    >
      {(entries) => {
        const notes = new Map(entries.map((entry) => [entry.media.id, finishedNote({ entry })]))
        return (
          <>
            <MediaTiles
              items={entries.map((entry) => entry.media)}
              note={(media) => notes.get(media.id) ?? null}
              posters={matchType === 'movie'}
              matchType={matchType}
            />
            <ButtonLink
              to={`/libraries/${library.id}/history`}
              icon="history"
              className={styles.more}
            >
              Full history
            </ButtonLink>
          </>
        )
      }}
    </SectionBody>
  )
}

/** Each tab's content. */
const SECTION_VIEWS = {
  all: AllSection,
  'in-progress': InProgressSection,
  favourites: FavouritesSection,
  sagas: SagasSection,
  'not-matched': NotMatchedSection,
  duplicates: DuplicatesSection,
  finished: FinishedSection,
} as const satisfies Record<LibrarySection, (props: { library: Library }) => ReactNode>

/** The open tab's content. */
export const SectionView = ({
  library,
  section,
}: {
  library: Library
  section: LibrarySection
}) => {
  const View = SECTION_VIEWS[section]
  return <View library={library} />
}
