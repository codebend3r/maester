import {
  type LibrarySettings,
  type MediaItem,
  WATCH_TARGET_KINDS,
  emptyListingMessage,
  isScanning,
  jumpScale,
  listsShows,
  queueLink,
  showEntryKey,
  watchLink,
} from '@raven/core'
import { classNames } from '@raven/ui'
import { QueryView, type QueryRead } from '@raven/ui/headless'
import { useDeferredValue, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { JumpPicker } from '@/components/JumpPicker/JumpPicker'
import { LibraryToolbar, ShowLevelPicker } from '@/components/LibraryToolbar/LibraryToolbar'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import {
  type SelectionEntry,
  SelectionScope,
  mediaEntryOf,
  sourceOf,
} from '@/components/SelectionScope/SelectionScope'
import { Spinner } from '@/components/Spinner/Spinner'
import { SHOW_LEVELS, type ShowLevel } from '@/lib/showLevels'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { LibraryListing, LibraryListingSkeleton } from '@/pages/LibraryPage/LibraryViews'
import { type Listing, NOTHING_LISTED, playQueue } from '@/pages/LibraryPage/libraryShape'
import {
  SectionFailed,
  SectionMessage,
  type SectionProps,
} from '@/pages/LibraryPage/sections/sectionParts'
import { useLibraryListing } from '@/pages/LibraryPage/useLibraryListing'
import { useLibraryView } from '@/pages/LibraryPage/useLibraryView'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

type SameLayoutProps = { a: LibrarySettings; b: LibrarySettings }

/** Whether two settings lay a listing out the same way. */
const sameLayout = ({ a, b }: SameLayoutProps): boolean =>
  a.view === b.view && a.sort === b.sort && a.groupBy === b.groupBy

/** What the listing holds once read, or nothing while it is on its way or failed. */
const listedOf = (listing: QueryRead<Listing>): Listing =>
  !listing.isError && !listing.isPending ? listing.data : NOTHING_LISTED

/** Whether a listing holds nothing at all. */
const isEmptyListing = ({ shows, seasons, files }: Listing): boolean =>
  shows.length === 0 && seasons.length === 0 && files.length === 0

/**
 * Every video or show in the library, searched, sorted and laid out as it
 * was left, with Play and Shuffle, and a strip down the side that jumps
 * through the order. The strip scrolls within this tab's cards.
 */
export const AllSection = ({ library }: SectionProps) => {
  const cards = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const view = useLibraryView({ library })
  const [level, setLevel] = useState<ShowLevel>(SHOW_LEVELS.shows)
  // The listing follows a change of view once it can lay itself out, the old one standing till then.
  const settings = useDeferredValue(view.settings)
  const isChanging = !sameLayout({ a: settings, b: view.settings })
  const isLibraryScanning = isScanning(library.scan)
  const listing = useLibraryListing({
    libraryId: library.id,
    settings,
    level,
    search: view.query,
    seed: view.seed,
    isScanning: isLibraryScanning,
  })
  const listed = listedOf(listing)
  const queue = playQueue({ settings, listing: listed })
  /*
   * The strip down the side follows the order: letters for titles, steps of
   * the value sorted by for the rest, none for a random order.
   */
  const scale = jumpScale({
    sort: settings.sort,
    files: listed.files,
    shows: listed.shows,
    source: settings.ratingsSource,
  })
  const empty = emptyListingMessage({
    isEmpty: isEmptyListing(listed),
    query: view.query,
    isScanning: isLibraryScanning,
  })
  const isEmpty = !listing.isError && !listing.isPending && empty !== null

  /*
   * The item rides along in router state, as a card click hands it over, so
   * the player starts without fetching it again.
   */
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
      <div ref={cards} className={classNames([styles.section, !!scale && styles.withJump])}>
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

        {scale && !isEmpty && <JumpPicker scale={scale} scope={cards} />}

        <div className={styles.listing} aria-busy={isChanging}>
          <div className={classNames([styles.listingBody, isChanging && styles.changing])}>
            <QueryView
              query={listing}
              pending={<LibraryListingSkeleton settings={settings} />}
              renderFailed={(error) => <SectionFailed error={error} />}
              empty={{
                isEmpty: () => empty !== null,
                shown: empty !== null && <SectionMessage message={empty} />,
              }}
            >
              {({ shows, seasons, files }) => (
                <LibraryListing
                  settings={settings}
                  level={level}
                  shows={shows}
                  seasons={seasons}
                  files={files}
                />
              )}
            </QueryView>
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
