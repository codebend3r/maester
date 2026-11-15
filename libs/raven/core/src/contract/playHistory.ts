import { isArtistCredit } from '@/contract/music'
import { isSeconds } from '@/contract/viewing'
import {
  type Infer,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  optional,
  union,
  literal,
} from '@/schema'

/*
 * Play history: every time an account started a video or a track, however
 * briefly, with how far it got. An account reads its own; the owner reads
 * everyone's.
 */

export const PLAY_HISTORY_PARAMS = {
  id: 'id',
  before: 'before',
  limit: 'limit',
  show: 'show',
  account: 'account',
} as const

export const PLAY_HISTORY_PATHS = {
  /** An account's own history, newest first. */
  own: '/api/history',
  /** Everyone's history, newest first, for the owner. */
  everyone: '/api/admin/history',
  /** A track started playing: answers the listen's id, for its later reports. */
  startListen: '/api/media/:id/listens',
  /** How far a listen got since it started. */
  listen: '/api/history/listens/:id',
} as const

/** How many entries a page holds unless the request asks, and the most it may ask for. */
export const PLAY_HISTORY_PAGE = { size: 50, most: 200 } as const

/** What a history shows: everything, only videos, or only music. */
export const PLAY_HISTORY_SHOWS = { all: 'all', video: 'video', music: 'music' } as const

export const isPlayHistoryShow = oneOf(Object.values(PLAY_HISTORY_SHOWS))

export type PlayHistoryShow = Infer<typeof isPlayHistoryShow>

/** What a played file was: a movie or other video, an episode of a show, or a music track. */
export const PLAYED_KINDS = { video: 'video', episode: 'episode', track: 'track' } as const

const isPlayedVideo = object({
  kind: literal(PLAYED_KINDS.video),
  title: isString,
  year: nullable(isNumber),
  /** The movie it was matched to, for its page; null for a file with none, absent from an older server. */
  itemId: optional(nullable(isNumber)),
})

const isPlayedEpisode = object({
  kind: literal(PLAYED_KINDS.episode),
  show: isString,
  season: nullable(isNumber),
  episode: nullable(isNumber),
  title: isString,
  /** The episode's and its show's items, for their pages; absent from an older server. */
  itemId: optional(isNumber),
  showId: optional(isNumber),
})

const isPlayedTrack = object({
  kind: literal(PLAYED_KINDS.track),
  title: isString,
  /** Every artist credited on the track, in order; null when its tags name none. */
  artist: nullable(isString),
  /** The same artists one by one, for their pages; absent from an older server. */
  artists: optional(listOf(isArtistCredit)),
  album: isString,
  albumId: isNumber,
  disc: isNumber,
  number: nullable(isNumber),
  /** How many tracks its album holds, so a run of them can say whether the whole album played. */
  albumTracks: isNumber,
})

export const isPlayed = union(isPlayedVideo, isPlayedEpisode, isPlayedTrack)

export type Played = Infer<typeof isPlayed>

/** One sitting with one file: when it started, when it last played, and how far it got. */
export const isPlayHistoryEntry = object({
  /** The entry's number, which grows with every sitting any account starts: the history's order. */
  id: isNumber,
  accountId: isString,
  mediaId: isNumber,
  startedAt: isString,
  lastPlayedAt: isString,
  /** The furthest it got, in seconds; null for a listen kept from before the history, whose reach is unknown. */
  furthest: nullable(isNumber),
  /** The file's length in seconds; null until it is probed. */
  duration: nullable(isNumber),
  libraryId: isNumber,
  libraryName: isString,
  played: isPlayed,
})

export type PlayHistoryEntry = Infer<typeof isPlayHistoryEntry>

/** One page of a history, and the cursor of the next (its last entry's id), or null after the last. */
export const isPlayHistoryPage = object({
  entries: listOf(isPlayHistoryEntry),
  next: nullable(isNumber),
})

export type PlayHistoryPage = Infer<typeof isPlayHistoryPage>

/** `POST /api/media/:id/listens`: where the track was when it started playing. */
export const isListenStart = object({ position: isSeconds })

export type ListenStart = Infer<typeof isListenStart>

/** The listen a start made, for the reports that follow it. */
export const isListenStarted = object({ id: isNumber })

export type ListenStarted = Infer<typeof isListenStarted>

/** `PUT /api/history/listens/:id`: where the track has got to. */
export const isListenReport = object({ position: isSeconds })

export type ListenReport = Infer<typeof isListenReport>
