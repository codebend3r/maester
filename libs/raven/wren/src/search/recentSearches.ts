import {
  type AlbumSummary,
  type Artist,
  type Infer,
  artistNames,
  isRecord,
  isString,
  matching,
  tagged,
  wholeNumberIn,
} from '@raven/core'

import { SEARCH_COPY } from '@/copy/screens'

/** The key the recent searches are stored under on the device. */
export const RECENT_SEARCHES_KEY = 'wren.recentSearches'

/** How many recent searches Search keeps, the newest first. */
export const RECENT_SEARCHES_KEPT = 10

/** What a recent search was: words searched for, or an artist or an album a search opened. */
export const RECENT_KINDS = { query: 'query', artist: 'artist', album: 'album' } as const

/** A recent search as it is kept: words that are not blank, or an artist or an album by id. */
const isRecentSearch = tagged({
  tag: 'kind',
  variants: {
    [RECENT_KINDS.query]: { text: matching(/\S/) },
    [RECENT_KINDS.artist]: { id: wholeNumberIn({ min: 0 }), name: isString },
    [RECENT_KINDS.album]: { id: wholeNumberIn({ min: 0 }), title: isString, artists: isString },
  },
})

export type RecentSearch = Infer<typeof isRecentSearch>

/** A recent search that opens a page when pressed: an artist or an album, by id. */
export type RecentPage = Exclude<RecentSearch, { kind: typeof RECENT_KINDS.query }>

/** Whether a press on a recent search opens its page, an artist's or an album's; words are searched again instead. */
export const isRecentPage = (recent: RecentSearch): recent is RecentPage =>
  recent.kind !== RECENT_KINDS.query

/** A recent search's identity, so the same one searched again moves to the top rather than twice. */
export const recentKeyOf = (recent: RecentSearch): string => {
  switch (recent.kind) {
    case RECENT_KINDS.query:
      return `${recent.kind}:${recent.text.toLocaleLowerCase()}`
    case RECENT_KINDS.artist:
    case RECENT_KINDS.album:
      return `${recent.kind}:${recent.id}`
    default: {
      const unknownKind: never = recent
      return unknownKind
    }
  }
}

/** The recent searches kept, each once, newest first, at most `RECENT_SEARCHES_KEPT`. */
const keptOf = (recents: readonly RecentSearch[]): RecentSearch[] =>
  recents
    .filter(
      (recent, index) =>
        recents.findIndex((other) => recentKeyOf(other) === recentKeyOf(recent)) === index,
    )
    .slice(0, RECENT_SEARCHES_KEPT)

/** What was read back: every entry that is a recent search, the rest dropped. */
export const recentSearchesOf = (saved: unknown): RecentSearch[] => {
  const entries = isRecord(saved) && Array.isArray(saved.recents) ? saved.recents : []
  return keptOf(entries.filter(isRecentSearch))
}

type WithRecentProps = { recents: readonly RecentSearch[]; recent: RecentSearch }

/**
 * The list with a search remembered at its top, an earlier copy of it dropped; a blank search
 * leaves the list as it was.
 */
export const withRecent = ({ recents, recent }: WithRecentProps): RecentSearch[] =>
  isRecentSearch(recent) ? keptOf([recent, ...recents]) : [...recents]

type WithoutRecentProps = { recents: readonly RecentSearch[]; key: string }

/** The list with the search of that key (`recentKeyOf`) forgotten. */
export const withoutRecent = ({ recents, key }: WithoutRecentProps): RecentSearch[] =>
  recents.filter((recent) => recentKeyOf(recent) !== key)

type MergedRecentsOfProps = { current: readonly RecentSearch[]; saved: unknown }

/** What was searched before the saved list was read, on top of what was read. */
export const mergedRecentsOf = ({ current, saved }: MergedRecentsOfProps): RecentSearch[] =>
  keptOf([...current, ...recentSearchesOf(saved)])

/** An album a search opened, as it is remembered. */
export const recentOfAlbum = (album: AlbumSummary): RecentSearch => ({
  kind: RECENT_KINDS.album,
  id: album.id,
  title: album.title,
  artists: artistNames(album),
})

/** An artist a search opened, as it is remembered. */
export const recentOfArtist = (artist: Artist): RecentSearch => ({
  kind: RECENT_KINDS.artist,
  id: artist.id,
  name: artist.name,
})

/** What a recent search shows: its name and what it was. */
type RecentText = { name: string; line: string }

/** A recent search as its row reads: the words, the artist or the album, and which of them it is. */
export const recentTextOf = (recent: RecentSearch): RecentText => {
  switch (recent.kind) {
    case RECENT_KINDS.query:
      return { name: recent.text, line: SEARCH_COPY.recentSearch }
    case RECENT_KINDS.artist:
      return { name: recent.name, line: SEARCH_COPY.recentArtist }
    case RECENT_KINDS.album:
      return {
        name: recent.title,
        line: SEARCH_COPY.recentAlbum({ kind: SEARCH_COPY.album, artists: recent.artists }),
      }
    default: {
      const unknownKind: never = recent
      return unknownKind
    }
  }
}
