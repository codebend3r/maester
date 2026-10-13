import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  type AiSuggestion,
  type Library,
  type LibrarySettings,
  type MediaItem,
  type PosterEntry,
  type UnmatchedFile,
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
import { SuggestedMovies } from '@/components/SuggestedMovies/SuggestedMovies'
import { UnmatchedShows } from '@/components/UnmatchedShows/UnmatchedShows'
import { useAdminLocked } from '@/lib/adminLock'
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
import { type ListingState, NOTHING_LISTED, playQueue } from '@/pages/LibraryPage/libraryShape'
import type { LibrarySection } from '@/pages/LibraryPage/librarySections'
import { useAiLookupsDone } from '@/pages/LibraryPage/useAiLookupsDone'
import { useLibraryListing } from '@/pages/LibraryPage/useLibraryListing'
import { useLibraryView } from '@/pages/LibraryPage/useLibraryView'
import { POLL_MS, anyPending, useMatchingPassDone } from '@/pages/LibraryPage/useMatchingPassDone'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** How many finished videos the tab shows; the History page has the rest. */
const FINISHED_LIMIT = 48

/** What the page says in place of a listing with nothing in it, or null while there is something. */
const emptyMessage = ({
  empty,
  query,
  scanning,
}: {
  empty: boolean
  query: string
  scanning: boolean
}): string | null => {
  if (!empty) return null
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

/** The listing as it stands: its shape on its way, why it could not be read, why it is empty, or itself. */
const ListingBody = ({
  listing,
  settings,
  empty,
}: {
  listing: ListingState
  settings: LibrarySettings
  empty: string | null
}) => {
  switch (listing.state) {
    case 'pending':
      return <LibraryListingSkeleton settings={settings} />
    case 'failed':
      return (
        <p className={styles.message} role="alert">
          {listing.error.message}
        </p>
      )
    case 'listed':
      return empty ? (
        <p className={styles.message}>{empty}</p>
      ) : (
        <LibraryListing settings={settings} shows={listing.shows} files={listing.files} />
      )
    default: {
      const unknown: never = listing
      return unknown
    }
  }
}

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
  const listed = listing.state === 'listed' ? listing : NOTHING_LISTED
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
    listing.state === 'listed'
      ? emptyMessage({
          empty: listed.shows.length === 0 && listed.files.length === 0,
          query: view.query,
          scanning,
        })
      : null

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

      <ListingBody listing={listing} settings={settings} empty={empty} />
    </div>
  )
}

/** What was left partway through, the most recently watched first. */
const InProgressSection = ({ library }: { library: Library }) => {
  const query = useQuery(inProgressQuery(library.id))
  return (
    <SectionBody
      query={query}
      shape={<MediaGridSkeleton posters={matchTypeFor(library.settings.kind) != null} />}
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
      shape={<MediaGridSkeleton posters={matchTypeFor(library.settings.kind) != null} />}
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

/** What the AI lookup suggests for a file, read off the Not matched listing. */
const suggestionsIn =
  (files: readonly UnmatchedFile[]) =>
  (file: MediaItem): AiSuggestion | null =>
    files.find((each) => each.id === file.id)?.aiSuggestion ?? null

/** What the Not matched tab says to do about its files: Fix match, once the admin lock is off. */
const notMatchedHint = ({
  matchType,
  canManage,
}: {
  matchType: ReturnType<typeof matchTypeFor>
  canManage: boolean
}): string => {
  const title = matchType ?? 'title'
  if (!canManage) return `Turn the admin lock off in Settings to point these at the right ${title}.`
  if (matchType === 'show') {
    return 'Choose Fix match beside a show to point its folder at the right show.'
  }
  return `Open a file's menu and choose Fix match to point it at the right ${title}.`
}

/**
 * The files no movie or show was found for, each with Fix match in its menu,
 * and what the AI lookup suggests where it was not sure. While TMDB answers,
 * the tab keeps reading again until none is pending, then reads the library
 * again for its count of files not matched. The lookups run after that, so
 * once they end, the tab reads both again.
 */
const NotMatchedSection = ({ library }: { library: Library }) => {
  const matchType = matchTypeFor(library.settings.kind)
  const metadata = useQuery(metadataHealthQuery)
  const canMatch = metadata.data?.tmdb === 'ok'
  const canManage = !useAdminLocked()
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
      shape={matchType === 'show' ? <MediaTilesSkeleton /> : <MediaGridSkeleton />}
      empty={whenEmpty(`Every file in ${library.name} is matched.`)}
    >
      {(files) => (
        <>
          <p className={styles.message}>{notMatchedHint({ matchType, canManage })}</p>
          {matchType === 'show' ? (
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
          ) : (
            <>
              <SuggestedMovies files={files} libraryId={library.id} />
              <MediaGrid
                items={files}
                matchType={matchType}
                ratingsSource={library.settings.ratingsSource}
              />
            </>
          )}
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
