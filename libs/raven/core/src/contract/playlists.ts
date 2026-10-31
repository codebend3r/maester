import { isTrack } from '@/contract/music'
import { type Infer, isBoolean, isNumber, isString, listOf, matching, object } from '@/schema'

/** How long a playlist's name may be, and how many tracks one request may name. */
export const PLAYLIST_LIMITS = { name: 200, tracks: 5000 } as const

/**
 * A playlist as a list shows it, the caller's own or another account's
 * shared one: its tracks and length count only those the caller may see.
 */
export const isPlaylistSummary = object({
  id: isNumber,
  name: isString,
  trackCount: isNumber,
  /** Seconds across the tracks counted. */
  duration: isNumber,
  createdAt: isString,
  updatedAt: isString,
  /** Whether every account on the server may read it, play it and copy it. */
  isShared: isBoolean,
  /** Whether it is the caller's, and so the caller's to change; another's is read only. */
  isOwn: isBoolean,
})

export type PlaylistSummary = Infer<typeof isPlaylistSummary>

export const isPlaylistList = listOf(isPlaylistSummary)

/** A playlist's page: the summary and its tracks in order, each as an album lists it. */
export const isPlaylistDetails = object({
  playlist: isPlaylistSummary,
  tracks: listOf(isTrack),
})

export type PlaylistDetails = Infer<typeof isPlaylistDetails>

/** A name with something besides spaces in it, up to `PLAYLIST_LIMITS.name` characters. */
export const isPlaylistName = matching(
  new RegExp(`^(?=[\\s\\S]*\\S)[\\s\\S]{1,${PLAYLIST_LIMITS.name}}$`, 'u'),
)

/** `POST /api/playlists` and `PUT /api/playlists/:id`: the playlist's name. */
export const isPlaylistInput = object({ name: isPlaylistName })

export type PlaylistInput = Infer<typeof isPlaylistInput>

/** A media id: a whole number from 1. */
const isMediaId = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1

const isMediaIds = (value: unknown): value is number[] =>
  listOf(isMediaId)(value) && value.length <= PLAYLIST_LIMITS.tracks

/**
 * `PUT /api/playlists/:id/tracks`, the whole order in place of the old, and
 * `POST /api/playlists/:id/tracks`, tracks to add at the end: up to
 * `PLAYLIST_LIMITS.tracks` track ids, the same one as often as it is wanted.
 */
export const isPlaylistTracksChange = object({ mediaIds: isMediaIds })

export type PlaylistTracksChange = Infer<typeof isPlaylistTracksChange>

/** `PUT /api/playlists/:id/sharing`: whether the owner's playlist is shared with every account. */
export const isPlaylistSharing = object({ isShared: isBoolean })

export type PlaylistSharing = Infer<typeof isPlaylistSharing>
