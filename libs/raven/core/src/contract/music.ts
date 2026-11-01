import { isMatchState } from '@/contract/items'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
} from '@/schema'

/** What a release is, as its tags or MusicBrainz say: `album` when nothing says. */
export const ALBUM_TYPES = {
  album: 'album',
  ep: 'ep',
  single: 'single',
  compilation: 'compilation',
  live: 'live',
  soundtrack: 'soundtrack',
} as const

export const isAlbumType = oneOf(Object.values(ALBUM_TYPES))

export type AlbumType = Infer<typeof isAlbumType>

/** An artist as an album or a track names one: enough for a link and its text. */
export const isArtistCredit = object({
  id: isNumber,
  name: isString,
})

export type ArtistCredit = Infer<typeof isArtistCredit>

type ArtistNamesProps = { artists: readonly ArtistCredit[] }

/** The credited artists as one line: "Radiohead", or "A, B" for several. */
export const artistNames = ({ artists }: ArtistNamesProps): string =>
  artists.map(({ name }) => name).join(', ')

/** An artist among a library's, with how much of the library is theirs. */
export const isArtist = object({
  id: isNumber,
  name: isString,
  /** The name as it sorts: "Beatles, The" for The Beatles, when the tags say. */
  sortName: isString,
  /** The MusicBrainz artist id, when the tags carry one. */
  mbid: nullable(isString),
  /** Albums credited to the artist: in the library listed, or on the artist's page in the libraries the caller sees. */
  albumCount: isNumber,
  /** Tracks credited to the artist, counted the same way. */
  trackCount: isNumber,
})

export type Artist = Infer<typeof isArtist>

export const isArtistList = listOf(isArtist)

/** An album among a library's, as a cover in a grid or a row in a list. */
export const isAlbumSummary = object({
  id: isNumber,
  libraryId: isNumber,
  title: isString,
  sortTitle: isString,
  /** The release's year, from the tags; null when they say none. */
  year: nullable(isNumber),
  /** ISO calendar date with year, month or day precision; no invented components. */
  releaseDate: nullable(isString),
  type: isAlbumType,
  /** The album's artists, in credit order; one entry, "Various Artists", for a compilation. */
  artists: listOf(isArtistCredit),
  isCompilation: isBoolean,
  trackCount: isNumber,
  /** Seconds across its tracks, counting those probed so far. */
  duration: isNumber,
  /** Changes with the cover, so its address caches for good; null while the album has none. */
  coverVersion: nullable(isString),
  /** How far matching to MusicBrainz got: see `MatchState`; `off` never applies to an album. */
  match: isMatchState,
  /** When its first track came in. */
  addedAt: isString,
})

export type AlbumSummary = Infer<typeof isAlbumSummary>

export const isAlbumList = listOf(isAlbumSummary)

/** One track: a file in a music library, as its album and the queue list it. */
export const isTrack = object({
  /** The file's media id, which plays, saves progress and favourites as any file's does. */
  id: isNumber,
  libraryId: isNumber,
  albumId: isNumber,
  title: isString,
  /** The disc the track is on, 1 for a single disc. */
  disc: isNumber,
  /** The track's number on its disc; null when the tags say none. */
  number: nullable(isNumber),
  /** Seconds, or null until the file has been read. */
  duration: nullable(isNumber),
  /** The track's own artists, in credit order; the album's when its tags name none. */
  artists: listOf(isArtistCredit),
  /** The file's container as `containerOf` names it: 'flac', 'mp3', 'm4a', ... */
  container: isString,
  /** ffprobe's codec name: 'flac', 'mp3', 'aac', 'alac', 'opus', ... */
  codec: nullable(isString),
  /** Bits per second across the file. */
  bitrate: nullable(isNumber),
  sampleRate: nullable(isNumber),
  bitDepth: nullable(isNumber),
  isLossless: isBoolean,
  /** The MusicBrainz recording id, when the tags carry one. */
  mbid: nullable(isString),
  addedAt: isString,
  /** The album's name and cover, so a queue, the bar and the lock screen need no second fetch. */
  album: object({ title: isString, coverVersion: nullable(isString) }),
  /**
   * ReplayGain in dB and true peaks as ratios of full scale, from the tags
   * or the server's loudness scan; null where neither gave one. `levelOf`
   * turns them into a volume factor.
   */
  gain: object({
    track: nullable(isNumber),
    album: nullable(isNumber),
    trackPeak: nullable(isNumber),
    albumPeak: nullable(isNumber),
  }),
})

export type Track = Infer<typeof isTrack>

/** A page of a library's tracks: `GET /api/libraries/:id/tracks` with `limit` and `offset`. */
export const isTrackPage = object({
  tracks: listOf(isTrack),
  /** How many tracks the whole listing holds, so a client can page. */
  total: isNumber,
})

export type TrackPage = Infer<typeof isTrackPage>

/** An album's page: the summary, what else the tags say of it, and its tracks in disc and number order. */
export const isAlbumDetails = object({
  album: isAlbumSummary,
  label: nullable(isString),
  genres: isStringArray,
  /** The MusicBrainz release id, when the tags carry one. */
  mbid: nullable(isString),
  /** How many discs its tracks span. */
  discCount: isNumber,
  tracks: listOf(isTrack),
  /** Whether the caller marked the album a favourite. */
  isFavourite: isBoolean,
})

export type AlbumDetails = Infer<typeof isAlbumDetails>

/** An artist's page: their albums, and the albums of others they appear on. */
export const isArtistDetails = object({
  artist: isArtist,
  albums: listOf(isAlbumSummary),
  appearsOn: listOf(isAlbumSummary),
  /** Whether the caller marked the artist a favourite. */
  isFavourite: isBoolean,
})

export type ArtistDetails = Infer<typeof isArtistDetails>

/** A MusicBrainz release id: a UUID. */
export const isMbid = matching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

/** One of MusicBrainz's releases, offered by Fix match for an album. */
export const isAlbumMatchCandidate = object({
  mbid: isMbid,
  title: isString,
  /** The release's artists as MusicBrainz credits them, joined: "A feat. B". */
  artist: isString,
  year: nullable(isNumber),
  trackCount: nullable(isNumber),
  type: isAlbumType,
  /** The release's country, ISO 3166-1, when MusicBrainz says. */
  country: nullable(isString),
  /** How sure Fix match is that this is the album: a whole number from 0 to 100. */
  confidence: isNumber,
})

export type AlbumMatchCandidate = Infer<typeof isAlbumMatchCandidate>

export const isAlbumMatchCandidateList = listOf(isAlbumMatchCandidate)

/** `PUT /api/albums/:id/match`: the release the album is, or null for none that MusicBrainz lists. */
export const isAlbumMatchChoice = object({ mbid: nullable(isMbid) })

export type AlbumMatchChoice = Infer<typeof isAlbumMatchChoice>

/** What each release type is called. */
export const ALBUM_TYPE_LABELS: Record<AlbumType, string> = {
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  compilation: 'Compilation',
  live: 'Live',
  soundtrack: 'Soundtrack',
}

/** What folding a music library's duplicate albums did: how many albums went into another. */
export const isAlbumMerge = object({ merged: isNumber })

export type AlbumMerge = Infer<typeof isAlbumMerge>
