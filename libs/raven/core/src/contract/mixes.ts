import { isAlbumSummary, isTrack } from '@/contract/music'
import { type Infer, isNumber, isString, listOf, object, oneOf } from '@/schema'

/**
 * The mixes the server makes from an account's plays and the library, one of
 * each kind, and the kind is the mix's id:
 * - `heavyRotation`: the most played in 30 days, and unplayed tracks by those artists;
 * - `rediscover`: played at least three times, and not in the last 90 days;
 * - `onThisDay`: played on this date in an earlier year;
 * - `recentlyAdded`: the tracks of albums added in the last 30 days.
 */
export const MIX_KINDS = {
  heavyRotation: 'heavyRotation',
  rediscover: 'rediscover',
  onThisDay: 'onThisDay',
  recentlyAdded: 'recentlyAdded',
} as const

export const isMixKind = oneOf(Object.values(MIX_KINDS))

export type MixKind = Infer<typeof isMixKind>

/** A mix as Home shows it: what it holds, and the covers of up to four of its albums. */
export const isMixSummary = object({
  id: isMixKind,
  trackCount: isNumber,
  /** Seconds across its tracks. */
  duration: isNumber,
  covers: listOf(object({ albumId: isNumber, coverVersion: isString })),
})

export type MixSummary = Infer<typeof isMixSummary>

export const isMixList = listOf(isMixSummary)

/** `GET /api/music/mixes/:id`: the mix and its tracks in the order they play, the same all day. */
export const isMixDetails = object({ mix: isMixSummary, tracks: listOf(isTrack) })

export type MixDetails = Infer<typeof isMixDetails>

/** What a radio starts from, written `<kind>:<id>` in `?seed=`: a track by its media id, an artist or an album. */
export const RADIO_SEED_KINDS = { track: 'track', artist: 'artist', album: 'album' } as const

export const isRadioSeedKind = oneOf(Object.values(RADIO_SEED_KINDS))

const isWholeId = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1

export const isRadioSeed = object({ kind: isRadioSeedKind, id: isWholeId })

export type RadioSeed = Infer<typeof isRadioSeed>

type RadioSeedTextProps = RadioSeed

/** The seed as `?seed=` carries it. */
export const radioSeedText = ({ kind, id }: RadioSeedTextProps): string => `${kind}:${id}`

/** The seed a `?seed=` names, or null for one it cannot read. */
export const radioSeedOf = (text: unknown): RadioSeed | null => {
  const match = /^([a-z]+):([1-9]\d{0,8})$/u.exec(isString(text) ? text : '')
  const seed = { kind: match?.[1] ?? null, id: Number(match?.[2] ?? 0) }
  return isRadioSeed(seed) ? seed : null
}

/** `GET /api/music/radio?seed=`: up to 50 tracks around the seed, in the order they play. */
export const isRadioTracks = listOf(isTrack)

/** Where the mixes, the radio and Home's recent albums are asked for, and the radio's one parameter. */
export const DISCOVERY_PATHS = {
  mixes: '/api/music/mixes',
  mix: '/api/music/mixes/:id',
  radio: '/api/music/radio',
  recent: '/api/music/recent',
} as const

export const RADIO_PARAMS = { seed: 'seed' } as const

/** `GET /api/music/recent`, for Home: the albums last played, and the albums last added. */
export const isRecentAlbums = object({
  played: listOf(isAlbumSummary),
  added: listOf(isAlbumSummary),
})

export type RecentAlbums = Infer<typeof isRecentAlbums>
