import { type AudioQuality, fileQualityOf, qualityChipsOf, qualityRestOf } from '@/audioQuality'
import {
  ALBUM_TYPES,
  ALBUM_TYPE_LABELS,
  type AlbumDetails,
  type AlbumSummary,
  type ArtistCredit,
  type Track,
  artistNames,
} from '@/contract'
import { formatDuration } from '@/format'
import { albumDateLabel } from '@/musicDates'
import { MUSIC_ROWS_COPY } from '@/musicRows'
import { plural } from '@/plural'

/**
 * What a long press on a cover tells of its album or of a track, each fact by what it is, so
 * every app labels it in its own words and shows the ones it chooses.
 */
export const MUSIC_FACTS = {
  artists: 'artists',
  album: 'album',
  released: 'released',
  kind: 'kind',
  genres: 'genres',
  label: 'label',
  tracks: 'tracks',
  length: 'length',
  /** The format and quality it plays in, which is not always its file's. */
  quality: 'quality',
  /** The format its file is in, or an album's files share. */
  format: 'format',
  plays: 'plays',
} as const

export type MusicFactKey = (typeof MUSIC_FACTS)[keyof typeof MUSIC_FACTS]

/** One fact of a cover's menu: what it is, and what it says. */
export type MusicFact = { key: MusicFactKey; value: string }

/**
 * How an app words the facts it says differently, and which facts it shows in what order, so
 * Raven and Wren read the same model.
 */
export type MusicFactWording = {
  /** The facts an album's menu shows, in the order it shows them. */
  albumFacts: readonly MusicFactKey[]
  /** The facts a track's menu shows, in the order it shows them. */
  trackFacts: readonly MusicFactKey[]
  /** An album's track count: Raven's "12 tracks", Wren's "12"; null to leave it unsaid. */
  trackCount: (count: number) => string | null
  /** An album's genres on one line: Raven's "Alternative, Rock", Wren's "Alternative · Rock". */
  genres: (genres: readonly string[]) => string
  /** An album's length: Raven's "53:21", Wren's "53 min"; null when it is not known. */
  albumLength: (seconds: number) => string | null
  /** A quality, or a format without its bitrate, on one line. */
  quality: (quality: AudioQuality) => string
}

/** The words Raven's facts say that no other row says. */
const RAVEN_FACT_COPY = {
  plays: { one: 'play', many: 'plays' },
} as const

/** How Raven, on the web, the desktop and the device app, words and orders a cover's facts. */
export const RAVEN_FACT_WORDING = {
  albumFacts: [
    MUSIC_FACTS.artists,
    MUSIC_FACTS.released,
    MUSIC_FACTS.kind,
    MUSIC_FACTS.genres,
    MUSIC_FACTS.label,
    MUSIC_FACTS.tracks,
    MUSIC_FACTS.length,
    MUSIC_FACTS.plays,
  ],
  trackFacts: [
    MUSIC_FACTS.artists,
    MUSIC_FACTS.album,
    MUSIC_FACTS.released,
    MUSIC_FACTS.length,
    MUSIC_FACTS.quality,
  ],
  trackCount: (count: number) => plural({ n: count, ...MUSIC_ROWS_COPY.tracks }),
  genres: (genres: readonly string[]) => genres.join(', '),
  albumLength: (seconds: number) => (seconds > 0 ? formatDuration(seconds) : null),
  /** "FLAC · 24-bit · 96 kHz · 2304 kbps". */
  quality: (quality: AudioQuality) =>
    MUSIC_ROWS_COPY.facts([...qualityChipsOf(quality), ...qualityRestOf(quality)]),
} as const satisfies MusicFactWording

/** What each fact is called beside its value in Raven's menus. */
export const MUSIC_FACT_LABELS = {
  artists: 'Artist',
  album: 'Album',
  released: 'Released',
  kind: 'Kind',
  genres: 'Genre',
  label: 'Label',
  tracks: 'Tracks',
  length: 'Length',
  quality: 'Quality',
  format: 'Format',
  plays: 'Played',
} as const satisfies Record<MusicFactKey, string>

/** What every fact could say, each null when there is nothing to say. */
type FactValues = Partial<Record<MusicFactKey, string | null>>

type FactsInProps = { values: FactValues; keys: readonly MusicFactKey[] }

/** The facts an app shows, in its order, each left out when there is nothing to say. */
const factsIn = ({ values, keys }: FactsInProps): MusicFact[] =>
  keys.flatMap((key) => {
    const value = values[key] ?? null
    return value === null || value === '' ? [] : [{ key, value }]
  })

/** What an album's page knows of it beyond its summary: its label, genres and tracks. */
type AlbumExtras = Pick<AlbumDetails, 'label' | 'genres' | 'tracks'>

type AlbumInfoOfProps = {
  album: AlbumSummary
  /** Its page's facts, once read; null until then. */
  extras: AlbumExtras | null
  wording: MusicFactWording
}

/** A plain album says nothing of its kind; an EP, a single, a live album and the rest do. */
const kindOf = (album: AlbumSummary): string | null =>
  album.type === ALBUM_TYPES.album ? null : ALBUM_TYPE_LABELS[album.type]

/** How many times the account played it, said only once it has. */
const playsOf = (album: AlbumSummary): string | null => {
  const plays = album.plays ?? 0
  return plays > 0 ? plural({ n: plays, ...RAVEN_FACT_COPY.plays }) : null
}

type AlbumFormatOfProps = { tracks: readonly Track[]; wording: MusicFactWording }

/**
 * The format an album's files share without their bitrates, which differ track by track:
 * "FLAC · 16-bit / 44.1 kHz"; null when its tracks are in more than one, or none is known.
 */
const albumFormatOf = ({ tracks, wording }: AlbumFormatOfProps): string | null => {
  const formats = new Set(
    tracks.map((track) => wording.quality({ ...fileQualityOf(track), bitrate: null })),
  )
  const [only] = formats
  return formats.size === 1 ? (only ?? null) : null
}

/**
 * What a long press on an album's cover tells of it: its artists, when it came out, its kind,
 * its genres, label and format once its page is read, how many tracks, how long, and how often
 * played, as many of them as the app shows.
 */
export const albumInfoOf = ({ album, extras, wording }: AlbumInfoOfProps): MusicFact[] =>
  factsIn({
    keys: wording.albumFacts,
    values: {
      [MUSIC_FACTS.artists]: artistNames(album),
      [MUSIC_FACTS.released]: albumDateLabel(album),
      [MUSIC_FACTS.kind]: kindOf(album),
      [MUSIC_FACTS.genres]: wording.genres(extras?.genres ?? []),
      [MUSIC_FACTS.label]: extras?.label ?? null,
      [MUSIC_FACTS.tracks]: wording.trackCount(album.trackCount),
      [MUSIC_FACTS.length]: wording.albumLength(album.duration),
      [MUSIC_FACTS.format]:
        extras === null ? null : albumFormatOf({ tracks: extras.tracks, wording }),
      [MUSIC_FACTS.plays]: playsOf(album),
    },
  })

type TrackInfoOfProps = {
  track: Track
  /** The track's album page, once read, for when it came out and its genres; null until then. */
  details: Pick<AlbumDetails, 'album' | 'genres'> | null
  /** The format and quality it plays in, or null until that is known. */
  quality: AudioQuality | null
  wording: MusicFactWording
}

/**
 * What a long press on a track's cover tells of it: its artists, its album, when that came out
 * and its genres, how long it runs, the quality it plays in and its file's format, as many of
 * them as the app shows.
 */
export const trackInfoOf = ({ track, details, quality, wording }: TrackInfoOfProps): MusicFact[] =>
  factsIn({
    keys: wording.trackFacts,
    values: {
      [MUSIC_FACTS.artists]: artistNames(track),
      [MUSIC_FACTS.album]: track.album.title,
      [MUSIC_FACTS.released]: details === null ? null : albumDateLabel(details.album),
      [MUSIC_FACTS.genres]: wording.genres(details?.genres ?? []),
      [MUSIC_FACTS.length]: track.duration === null ? null : formatDuration(track.duration),
      [MUSIC_FACTS.quality]: quality === null ? null : wording.quality(quality),
      [MUSIC_FACTS.format]: wording.quality(fileQualityOf(track)),
    },
  })

/** Where a cover's menu goes: the album, or one of its artists. */
export const MUSIC_LINKS = { album: 'album', artist: 'artist' } as const

export type MusicLink =
  | { kind: typeof MUSIC_LINKS.album; albumId: number }
  | {
      kind: typeof MUSIC_LINKS.artist
      artistId: number
      name: string
      /** Whether the line names the artist: only when there are several to tell apart. */
      isNamed: boolean
    }

/** A link's key, one per line: the album's, or each artist's own. */
export type MusicLinkKey = typeof MUSIC_LINKS.album | `${typeof MUSIC_LINKS.artist}:${number}`

/** The key a menu line keeps its link by. */
export const musicLinkKeyOf = (link: MusicLink): MusicLinkKey =>
  link.kind === MUSIC_LINKS.album ? MUSIC_LINKS.album : `${MUSIC_LINKS.artist}:${link.artistId}`

type MusicLinksOfProps = {
  /** The album Go to album opens; null where it would go nowhere, as on the album's own page. */
  albumId: number | null
  artists: readonly ArtistCredit[]
  /** Wren goes to the first of an album's artists only; Raven to each of them. */
  isFirstArtistOnly?: boolean
}

/**
 * Where a cover's menu goes: Go to album, unless there is none to go to, then Go to artist, one
 * per credited artist, each named once there are several, or to the first of them alone.
 */
export const musicLinksOf = ({
  albumId,
  artists,
  isFirstArtistOnly = false,
}: MusicLinksOfProps): MusicLink[] => {
  const shown = isFirstArtistOnly ? artists.slice(0, 1) : artists
  return [
    ...(albumId === null ? [] : [{ kind: MUSIC_LINKS.album, albumId }]),
    ...shown.map((artist) => ({
      kind: MUSIC_LINKS.artist,
      artistId: artist.id,
      name: artist.name,
      isNamed: shown.length > 1,
    })),
  ]
}

/** What Raven's menus say to go from an album or a track. */
export const MUSIC_LINK_COPY = {
  goToAlbum: 'Go to album',
  goToArtist: 'Go to artist',
  /** One of several artists, named so they can be told apart. */
  goToNamed: (name: string) => `Go to ${name}`,
} as const

/** Go to album, Go to artist, or Go to and the name when there are several artists. */
export const musicLinkLabelOf = (link: MusicLink): string => {
  if (link.kind === MUSIC_LINKS.album) return MUSIC_LINK_COPY.goToAlbum
  return link.isNamed ? MUSIC_LINK_COPY.goToNamed(link.name) : MUSIC_LINK_COPY.goToArtist
}
