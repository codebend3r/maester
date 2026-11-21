import {
  ALBUM_TYPES,
  type AlbumDetails,
  type AlbumSummary,
  type Artist,
  type ArtistDetails,
  FOLDER_LAYOUTS,
  LIBRARY_KINDS,
  LIBRARY_VIEWS,
  LYRICS_KINDS,
  LYRICS_SOURCES,
  type Library,
  type Lyrics,
  MATCH_STATES,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  PATH_LAYOUTS,
  type PlaylistDetails,
  type PlaylistSummary,
  RATINGS_REFRESH_STATES,
  RATING_SOURCES,
  SCAN_KINDS,
  SCAN_STATES,
  type Track,
  type TrackPage,
} from '@raven/core'

/*
 * raven's music as Wren's screens ask for it, the one library the phone app's tests and the web
 * app's both read: a films library and a music library holding OK Computer by Radiohead, and the
 * listener's Mixtape. Nothing here is bundled into an app; only tests import it, and each app's
 * `src/test/music.ts` has its own runner answer with it.
 */

type LibraryForProps = { id: number; name: string; kind: Library['settings']['kind'] }

const libraryFor = ({ id, name, kind }: LibraryForProps): Library => ({
  id,
  name,
  paths: [`/media/${name}`],
  layouts: [{ path: `/media/${name}`, layout: PATH_LAYOUTS.flat, groups: 0 }],
  itemCount: 3,
  unmatchedCount: 0,
  createdAt: '2026-09-27T00:00:00.000Z',
  scan: {
    state: SCAN_STATES.idle,
    kind: SCAN_KINDS.full,
    found: 3,
    processed: 3,
    startedAt: null,
    finishedAt: null,
    quickScannedAt: null,
    error: null,
  },
  settings: {
    saveProgress: false,
    pinned: true,
    inHero: false,
    sort: MEDIA_SORTS.title,
    view: LIBRARY_VIEWS.grid,
    groupBy: MEDIA_GROUPINGS.resolution,
    watchedPercent: 95,
    kind,
    ratingsSource: RATING_SOURCES.tmdb,
    autoRefresh: true,
    locked: false,
    folderLayout: FOLDER_LAYOUTS.auto,
    icon: null,
  },
  backdrop: null,
  ratingsRefresh: { state: RATINGS_REFRESH_STATES.idle, finishedAt: null },
})

export const MUSIC = libraryFor({ id: 5, name: 'Music', kind: LIBRARY_KINDS.music })
/** The music library as a library of audiobooks, so what it holds plays as a book. */
export const AUDIOBOOKS = libraryFor({
  id: MUSIC.id,
  name: 'Books',
  kind: LIBRARY_KINDS.audiobooks,
})
export const FILMS = libraryFor({ id: 1, name: 'Films', kind: LIBRARY_KINDS.movies })

export const RADIOHEAD: Artist = {
  id: 1,
  name: 'Radiohead',
  sortName: 'Radiohead',
  mbid: null,
  photoVersion: null,
  albumCount: 1,
  trackCount: 3,
}

export const OK_COMPUTER: AlbumSummary = {
  id: 7,
  libraryId: MUSIC.id,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  releaseDate: null,
  year: 1997,
  type: ALBUM_TYPES.album,
  artists: [{ id: RADIOHEAD.id, name: RADIOHEAD.name }],
  isCompilation: false,
  trackCount: 3,
  duration: 900,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt: '2026-01-01T00:00:00Z',
}

type TrackForProps = { id: number; title: string; disc?: number; number?: number }

/** A track of OK Computer. */
export const trackFor = ({ id, title, disc = 1, number = 1 }: TrackForProps): Track => ({
  id,
  libraryId: MUSIC.id,
  albumId: OK_COMPUTER.id,
  title,
  disc,
  number,
  duration: 300,
  artists: [{ id: RADIOHEAD.id, name: RADIOHEAD.name }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: OK_COMPUTER.title, coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
})

export const AIRBAG = trackFor({ id: 101, title: 'Airbag' })
export const PARANOID = trackFor({ id: 102, title: 'Paranoid Android', number: 2 })
export const LUCKY = trackFor({ id: 103, title: 'Lucky', disc: 2 })

export const OK_COMPUTER_PAGE: AlbumDetails = {
  album: OK_COMPUTER,
  label: null,
  genres: [],
  mbid: null,
  discCount: 2,
  tracks: [AIRBAG, PARANOID, LUCKY],
  isFavourite: false,
}

export const RADIOHEAD_PAGE: ArtistDetails = {
  artist: RADIOHEAD,
  albums: [OK_COMPUTER],
  appearsOn: [],
  isFavourite: false,
}

/** Airbag's words, timed to the music, a bar with none at its end. */
export const AIRBAG_LYRICS: Lyrics = {
  kind: LYRICS_KINDS.synced,
  source: LYRICS_SOURCES.lrclib,
  lines: [
    { at: 0, text: 'In the next world war' },
    { at: 12, text: 'In a jackknifed juggernaut' },
    { at: 20, text: '' },
  ],
}

export const MIXTAPE: PlaylistSummary = {
  id: 4,
  name: 'Mixtape',
  trackCount: 2,
  duration: 600,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  isShared: false,
  isOwn: true,
}

export const MIXTAPE_PAGE: PlaylistDetails = { playlist: MIXTAPE, tracks: [LUCKY, AIRBAG] }

/** Every song of the music library, as one page of its list. */
export const SONGS: TrackPage = { tracks: [AIRBAG, PARANOID, LUCKY], total: 3 }
