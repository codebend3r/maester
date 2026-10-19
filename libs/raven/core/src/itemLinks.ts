import { ITEM_TYPES, type ItemSummary, type MediaItem, isMediaItem, isMediaList } from '@/contract'
import { primaryVersion } from '@/items'
import { toQueryString } from '@/query'
import { type Infer, isBoolean, object } from '@/schema'

/** An address in the app, from its root. */
export type AppPath = `/${string}`

/** A season's page, by its show and number. */
const seasonPath = ({ showId, season }: { showId: number; season: number }): AppPath =>
  `/shows/${showId}/seasons/${season}`

/** Where an item's page lives, or null for one that has no page of its own. */
export const itemPath = (item: ItemSummary): AppPath | null => {
  if (item.type === ITEM_TYPES.movie) return `/movies/${item.id}`
  if (item.type === ITEM_TYPES.show) return `/shows/${item.id}`
  if (item.type === ITEM_TYPES.episode) return `/episodes/${item.id}`
  return item.show && item.season != null
    ? seasonPath({ showId: item.show.id, season: item.season })
    : null
}

/**
 * `page`, a movie's or an episode's, as library `libraryId` shows it: only
 * that library's files, so two libraries holding the same movie never mix
 * on its page. `file` names the one Play starts.
 */
export const inLibrary = ({
  page,
  libraryId,
  file = null,
}: {
  page: AppPath
  libraryId: number
  file?: number | null
}): AppPath =>
  `${page}?${toQueryString({
    library: String(libraryId),
    ...(file == null ? {} : { file: String(file) }),
  })}`

/** A whole-number id an address's query carries, or null for anything else. */
export const queryId = (value: string | null): number | null => {
  const id = Number(value ?? '')
  return value != null && value !== '' && Number.isInteger(id) ? id : null
}

/** The card a page shows: the chosen file's, else the movie's own while it has files, else Play's. */
const shownCard = ({
  everyCard,
  chosen,
}: {
  everyCard: readonly MediaItem[]
  chosen: MediaItem | undefined
}): string | null => {
  if (chosen) return chosen.card
  if (everyCard.some((version) => version.card == null)) return null
  return primaryVersion(everyCard)?.card ?? null
}

/**
 * The files a movie's or an episode's page shows, all from one library: the
 * one `?library=` names, else the one holding `?file=`'s file, else the one
 * holding the file Play would start (the one in progress, else the best).
 * A library holding none of the files counts as unnamed. Within it the page
 * is one card's: the card `?file=`'s file sits on, as a split card's link
 * names it, else the movie's own card while any file is still on it, else
 * the card of the file Play would start. `everyCard` is the library's files
 * on every card. `primary` is the file Play starts, `?file=`'s where it is
 * among them; null with no files.
 */
export const libraryFiles = ({
  versions,
  library,
  file,
}: {
  versions: readonly MediaItem[]
  library: number | null
  file: number | null
}): { versions: MediaItem[]; everyCard: MediaItem[]; primary: MediaItem } | null => {
  const named = versions.some((version) => version.libraryId === library) ? library : null
  const libraryId =
    named ??
    versions.find((version) => version.id === file)?.libraryId ??
    primaryVersion(versions)?.libraryId
  const everyCard = versions.filter((version) => version.libraryId === libraryId)
  const chosen = everyCard.find((version) => version.id === file)
  const card = shownCard({ everyCard, chosen })
  const shown = everyCard.filter((version) => version.card === card)
  const primary = chosen ?? primaryVersion(shown)
  return primary ? { versions: shown, everyCard, primary } : null
}

/** Where an episode's page leads back to: its season, else its show, else its library. */
export const episodeBackPath = ({
  item,
  libraryId,
}: {
  item: ItemSummary
  libraryId: number
}): string => {
  if (!item.show) return `/libraries/${libraryId}`
  return item.season == null
    ? `/shows/${item.show.id}`
    : seasonPath({ showId: item.show.id, season: item.season })
}

/**
 * What a link to the player hands over in router state: the video, the ones
 * to play after it, and whether they were shuffled rather than lined up in turn.
 */
const isWatchState = object({ media: isMediaItem, upNext: isMediaList, isShuffled: isBoolean })

export type WatchState = Infer<typeof isWatchState>

/**
 * The link to play a video, with the video riding along in router state so
 * the player starts without fetching it again, and any to play after it, in
 * turn, as Play all hands over a saga, or as a shuffle dealt them.
 */
export const watchLink = ({
  media,
  upNext = [],
  isShuffled = false,
}: {
  media: MediaItem
  upNext?: WatchState['upNext']
  isShuffled?: boolean
}): { to: AppPath; state: WatchState } => ({
  to: `/watch/${media.id}`,
  state: { media, upNext, isShuffled },
})

/** The link to play the first of `queue`, with the rest to play after it; null for an empty queue. */
export const queueLink = ({
  queue,
  isShuffled = false,
}: {
  queue: readonly MediaItem[]
  isShuffled?: boolean
}): { to: AppPath; state: WatchState } | null => {
  const [media, ...upNext] = queue
  return media ? watchLink({ media, upNext, isShuffled }) : null
}

/**
 * What `watchLink` handed over for video `id`; null for a direct visit, a
 * refresh of a link from before, or another video's state.
 */
export const readWatchState = ({
  state,
  id,
}: {
  state: unknown
  /** null for an address that names no video. */
  id: number | null
}): WatchState | null => (isWatchState(state) && state.media.id === id ? state : null)

/**
 * Where a card goes: a matched item's page as the card's library shows it,
 * where the library has pages, or straight to the player, with the video
 * handed over, for anything else. A card a movie was split onto names its
 * file, so the page plays that one.
 */
export const cardLink = ({
  media,
  hasPages,
}: {
  media: MediaItem
  hasPages: boolean
}): { to: AppPath; state?: WatchState } => {
  const page = hasPages && media.item ? itemPath(media.item) : null
  if (page == null) return watchLink({ media })
  return {
    to: inLibrary({
      page,
      libraryId: media.libraryId,
      file: media.variant == null ? null : media.id,
    }),
  }
}
