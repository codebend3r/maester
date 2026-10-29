import {
  ITEM_TYPES,
  type ItemSummary,
  type MediaItem,
  SESSION_KINDS,
  type ViewingSession,
  isMediaItem,
  isMediaList,
  isViewingSession,
} from '@/contract'
import { primaryVersion } from '@/items'
import { toQueryString } from '@/query'
import { type Infer, object } from '@/schema'

/** An address in the app, from its root. */
export type AppPath = `/${string}`

/** The app's pages that raven names from outside a page's own links: the desktop menu and links. */
export const PAGE_PATHS = {
  settings: '/settings',
  shortcuts: '/shortcuts',
  watch: '/watch',
} as const

/** The page that plays a video. */
export const watchPageOf = (mediaId: number): AppPath => `${PAGE_PATHS.watch}/${mediaId}`

type SeasonPathProps = { showId: number; season: number }

/** A season's page, by its show and number. */
const seasonPath = ({ showId, season }: SeasonPathProps): AppPath =>
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

type InLibraryProps = {
  page: AppPath
  libraryId: number
  file?: number | null
}

/**
 * `page`, a movie's or an episode's, as library `libraryId` shows it: only
 * that library's files, so two libraries holding the same movie never mix
 * on its page. `file` names the one Play starts.
 */
export const inLibrary = ({ page, libraryId, file = null }: InLibraryProps): AppPath =>
  `${page}?${toQueryString({
    library: String(libraryId),
    ...(file == null ? {} : { file: String(file) }),
  })}`

/** A whole-number id an address's query carries, or null for anything else. */
export const queryId = (value: string | null): number | null => {
  const id = Number(value ?? '')
  return value != null && value !== '' && Number.isInteger(id) ? id : null
}

type ShownCardProps = {
  everyCard: readonly MediaItem[]
  chosen: MediaItem | undefined
}

/** The card a page shows: the chosen file's, else the movie's own while it has files, else Play's. */
const shownCard = ({ everyCard, chosen }: ShownCardProps): string | null => {
  if (chosen) return chosen.card
  if (everyCard.some((version) => version.card == null)) return null
  return primaryVersion(everyCard)?.card ?? null
}

type LibraryFilesProps = {
  versions: readonly MediaItem[]
  library: number | null
  file: number | null
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
}: LibraryFilesProps): {
  versions: MediaItem[]
  everyCard: MediaItem[]
  primary: MediaItem
} | null => {
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

type EpisodeBackPathProps = {
  item: ItemSummary
  libraryId: number
}

/** Where an episode's page leads back to: its season, else its show, else its library. */
export const episodeBackPath = ({ item, libraryId }: EpisodeBackPathProps): string => {
  if (!item.show) return `/libraries/${libraryId}`
  return item.season == null
    ? `/shows/${item.show.id}`
    : seasonPath({ showId: item.show.id, season: item.season })
}

/**
 * The session a video plays in when its link names none: an episode rolls
 * on through its show, anything else plays on its own.
 */
export const sessionOf = (media: MediaItem): ViewingSession =>
  media.item?.type === ITEM_TYPES.episode
    ? { kind: SESSION_KINDS.show }
    : { kind: SESSION_KINDS.single }

/**
 * What a link to the player hands over in router state: the video, the
 * session it plays in, and for a queue the videos a shuffle dealt after it.
 */
const isWatchState = object({ media: isMediaItem, session: isViewingSession, upNext: isMediaList })

export type WatchState = Infer<typeof isWatchState>

type WatchLinkProps = {
  media: MediaItem
  session?: ViewingSession
  upNext?: WatchState['upNext']
}

/**
 * The link to play a video, with the video riding along in router state so
 * the player starts without fetching it again, and the session it plays in,
 * `sessionOf`'s unless the page names one. A queue's link carries the videos
 * to play after it.
 */
export const watchLink = ({
  media,
  session = sessionOf(media),
  upNext = [],
}: WatchLinkProps): { to: AppPath; state: WatchState } => ({
  to: watchPageOf(media.id),
  state: { media, session, upNext },
})

type QueueLinkProps = {
  queue: readonly MediaItem[]
}

/** The link to play the first of a shuffled `queue`, with the rest after it; null for an empty queue. */
export const queueLink = ({ queue }: QueueLinkProps): { to: AppPath; state: WatchState } | null => {
  const [media, ...upNext] = queue
  return media ? watchLink({ media, session: { kind: SESSION_KINDS.queue }, upNext }) : null
}

type ReadWatchStateProps = {
  state: unknown
  /** null for an address that names no video. */
  id: number | null
}

/**
 * What `watchLink` handed over for video `id`; null for a direct visit, a
 * refresh of a link from before, or another video's state.
 */
export const readWatchState = ({ state, id }: ReadWatchStateProps): WatchState | null =>
  isWatchState(state) && state.media.id === id ? state : null

/** Where a card goes: an item's page, or straight to the player. */
export const CARD_DESTINATIONS = { page: 'page', player: 'player' } as const

export type CardDestination =
  | {
      kind: typeof CARD_DESTINATIONS.page
      item: ItemSummary
      path: AppPath
      libraryId: number
      /** The file Play starts, named for a card a movie was split onto; null otherwise. */
      file: number | null
    }
  | { kind: typeof CARD_DESTINATIONS.player; media: MediaItem }

type CardDestinationProps = {
  media: MediaItem
  hasPages: boolean
}

/**
 * Where a card goes: a matched item's page as the card's library shows it,
 * where the library has pages, or straight to the player for anything else.
 * A card a movie was split onto names its file, so the page plays that one.
 */
export const cardDestination = ({ media, hasPages }: CardDestinationProps): CardDestination => {
  const path = hasPages && media.item ? itemPath(media.item) : null
  if (path == null || !media.item) return { kind: CARD_DESTINATIONS.player, media }
  return {
    kind: CARD_DESTINATIONS.page,
    item: media.item,
    path,
    libraryId: media.libraryId,
    file: media.variant == null ? null : media.id,
  }
}

type CardLinkProps = {
  media: MediaItem
  hasPages: boolean
}

/** A card's destination as a link: the page's address in its library, or the player's with the video handed over. */
export const cardLink = ({
  media,
  hasPages,
}: CardLinkProps): { to: AppPath; state?: WatchState } => {
  const destination = cardDestination({ media, hasPages })
  switch (destination.kind) {
    case CARD_DESTINATIONS.page:
      return {
        to: inLibrary({
          page: destination.path,
          libraryId: destination.libraryId,
          file: destination.file,
        }),
      }
    case CARD_DESTINATIONS.player:
      return watchLink({ media: destination.media })
    default: {
      const unknown: never = destination
      return unknown
    }
  }
}
