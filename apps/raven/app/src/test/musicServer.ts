import {
  ALBUM_TYPES,
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type AlbumDetails,
  type AlbumSummary,
  type ApiClient,
  type Artist,
  type ArtistDetails,
  LIBRARY_KINDS,
  LYRICS_KINDS,
  LYRICS_SOURCES,
  type Lyrics,
  MATCH_STATES,
  type Library,
  type MediaMarkers,
  NO_LYRICS,
  type PlaylistDetails,
  type PlaylistSummary,
  type Track,
  createApiClient,
  isFavouriteChange,
  isPlaylistInput,
  isPlaylistTracksChange,
} from '@raven/core'
import { allowlistedFetch } from '@raven/native/headless'

import {
  type Answer,
  type HeardRequest,
  NOT_FOUND,
  STATUSES,
  pathFor,
  responseOf,
} from '@/test/fixtureFetch'
import { FILMS, NAS } from '@/test/homeServer'

/** A music library on the test server. */
export const MUSIC: Library = {
  ...FILMS,
  id: 5,
  name: 'Music',
  settings: { ...FILMS.settings, kind: LIBRARY_KINDS.music },
}

export const RADIOHEAD: Artist = {
  id: 1,
  name: 'Radiohead',
  sortName: 'Radiohead',
  mbid: null,
  albumCount: 1,
  trackCount: 3,
}

export const PORTISHEAD: Artist = {
  id: 2,
  name: 'Portishead',
  sortName: 'Portishead',
  mbid: null,
  albumCount: 2,
  trackCount: 1,
}

export const OK_COMPUTER: AlbumSummary = {
  id: 7,
  libraryId: MUSIC.id,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
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

type TrackForProps = { id: number; title: string; disc: number; number: number }

/** A track of OK Computer. */
const trackFor = ({ id, title, disc, number }: TrackForProps): Track => ({
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

export const AIRBAG = trackFor({ id: 101, title: 'Airbag', disc: 1, number: 1 })
export const PARANOID = trackFor({ id: 102, title: 'Paranoid Android', disc: 1, number: 2 })
export const LUCKY = trackFor({ id: 103, title: 'Lucky', disc: 2, number: 1 })

const OK_COMPUTER_PAGE: AlbumDetails = {
  album: OK_COMPUTER,
  label: null,
  genres: [],
  mbid: null,
  discCount: 2,
  tracks: [AIRBAG, PARANOID, LUCKY],
  isFavourite: false,
}

const RADIOHEAD_PAGE: ArtistDetails = {
  artist: RADIOHEAD,
  albums: [OK_COMPUTER],
  appearsOn: [],
  isFavourite: false,
}

/** An audiobooks library on the test server. */
const BOOKS: Library = {
  ...FILMS,
  id: 6,
  name: 'Books',
  settings: { ...FILMS.settings, kind: LIBRARY_KINDS.audiobooks },
}

/** A book of three chapters, each ten minutes long, the last named by its place alone. */
export const DUNE_BOOK: Track = {
  ...AIRBAG,
  id: 201,
  libraryId: BOOKS.id,
  albumId: 20,
  title: 'Dune',
  duration: 1800,
  album: { title: 'Dune', coverVersion: null },
}

const DUNE_MARKERS: MediaMarkers = {
  intro: null,
  credits: null,
  chapters: [
    { start: 0, end: 600, title: 'Opening' },
    { start: 600, end: 1200, title: 'Arrakis' },
    { start: 1200, end: 1800, title: null },
  ],
}

/** Airbag's lyrics, timed: the second line is sung from 12 s. */
export const AIRBAG_LYRICS: Lyrics = {
  kind: LYRICS_KINDS.synced,
  source: LYRICS_SOURCES.sidecar,
  lines: [
    { at: 0, text: 'In the next world war' },
    { at: 12, text: 'In a jackknifed juggernaut' },
    { at: 20, text: '' },
  ],
}

/** Paranoid Android's lyrics, with no times. */
export const PARANOID_LYRICS = {
  kind: LYRICS_KINDS.plain,
  source: LYRICS_SOURCES.lrclib,
  text: 'Please could you stop the noise',
} as const satisfies Lyrics

export const MIXTAPE: PlaylistSummary = {
  id: 4,
  name: 'Mixtape',
  trackCount: 3,
  duration: 900,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  isShared: false,
  isOwn: true,
}

const MIXTAPE_PAGE: PlaylistDetails = { playlist: MIXTAPE, tracks: [AIRBAG, PARANOID, LUCKY] }

/** The id the test server gives a playlist it makes. */
export const NEW_PLAYLIST_ID = 9

const TRACKS: readonly Track[] = [AIRBAG, PARANOID, LUCKY, DUNE_BOOK]

const ANSWERS: Record<string, unknown> = {
  [APP_CLIENT_CALLS.listLibraries.path]: [MUSIC, BOOKS],
  [APP_CLIENT_CALLS.listPlaylists.path]: [MIXTAPE],
  [pathFor({ path: APP_CLIENT_CALLS.getPlaylist.path, id: MIXTAPE.id })]: MIXTAPE_PAGE,
  [pathFor({ path: APP_CLIENT_CALLS.getLyrics.path, id: AIRBAG.id })]: AIRBAG_LYRICS,
  [pathFor({ path: APP_CLIENT_CALLS.getLyrics.path, id: PARANOID.id })]: PARANOID_LYRICS,
  [pathFor({ path: APP_CLIENT_CALLS.getLyrics.path, id: LUCKY.id })]: NO_LYRICS,
  [pathFor({ path: APP_CLIENT_CALLS.getMarkers.path, id: DUNE_BOOK.id })]: DUNE_MARKERS,
  [pathFor({ path: APP_CLIENT_CALLS.getLibrary.path, id: MUSIC.id })]: MUSIC,
  [pathFor({ path: APP_CLIENT_CALLS.listAlbums.path, id: MUSIC.id })]: [OK_COMPUTER],
  [pathFor({ path: APP_CLIENT_CALLS.listArtists.path, id: MUSIC.id })]: [PORTISHEAD, RADIOHEAD],
  [pathFor({ path: APP_CLIENT_CALLS.getAlbum.path, id: OK_COMPUTER.id })]: OK_COMPUTER_PAGE,
  [pathFor({ path: APP_CLIENT_CALLS.getArtist.path, id: RADIOHEAD.id })]: RADIOHEAD_PAGE,
}

type WriteKeyOfProps = { method: string; path: string }

/** A write as the test server knows it: its method and its path. */
const writeKeyOf = ({ method, path }: WriteKeyOfProps): string => `${method} ${path}`

const ok = (body: unknown): Answer => ({ status: STATUSES.ok, body })

/** Mixtape's page holding the tracks `body` names, in its order, or a refusal. */
const mixtapeWith = (body: unknown): Answer => {
  if (!isPlaylistTracksChange(body)) return NOT_FOUND
  const tracks = body.mediaIds.flatMap((id) => TRACKS.filter((track) => track.id === id))
  return ok({ playlist: { ...MIXTAPE, trackCount: tracks.length }, tracks })
}

const { put, post, delete: remove } = APP_CALL_METHODS

const WRITES: Record<string, (body: unknown) => Answer> = {
  [writeKeyOf({
    method: put,
    path: pathFor({ path: APP_CLIENT_CALLS.setAlbumFavourite.path, id: OK_COMPUTER.id }),
  })]: (body) =>
    ok({ ...OK_COMPUTER_PAGE, isFavourite: isFavouriteChange(body) && body.favourite }),
  [writeKeyOf({
    method: put,
    path: pathFor({ path: APP_CLIENT_CALLS.setArtistFavourite.path, id: RADIOHEAD.id }),
  })]: (body) => ok({ ...RADIOHEAD_PAGE, isFavourite: isFavouriteChange(body) && body.favourite }),
  [writeKeyOf({ method: post, path: APP_CLIENT_CALLS.createPlaylist.path })]: (body) =>
    isPlaylistInput(body)
      ? ok({
          playlist: {
            ...MIXTAPE,
            id: NEW_PLAYLIST_ID,
            name: body.name,
            trackCount: 0,
            duration: 0,
          },
          tracks: [],
        })
      : NOT_FOUND,
  [writeKeyOf({
    method: put,
    path: pathFor({ path: APP_CLIENT_CALLS.renamePlaylist.path, id: MIXTAPE.id }),
  })]: (body) =>
    isPlaylistInput(body)
      ? ok({ ...MIXTAPE_PAGE, playlist: { ...MIXTAPE, name: body.name } })
      : NOT_FOUND,
  [writeKeyOf({
    method: remove,
    path: pathFor({ path: APP_CLIENT_CALLS.deletePlaylist.path, id: MIXTAPE.id }),
  })]: () => ({
    status: STATUSES.noContent,
    body: null,
  }),
  [writeKeyOf({
    method: put,
    path: pathFor({ path: APP_CLIENT_CALLS.replacePlaylistTracks.path, id: MIXTAPE.id }),
  })]: mixtapeWith,
  [writeKeyOf({
    method: post,
    path: pathFor({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: MIXTAPE.id }),
  })]: (body) =>
    isPlaylistTracksChange(body)
      ? mixtapeWith({
          mediaIds: [...MIXTAPE_PAGE.tracks.map((track) => track.id), ...body.mediaIds],
        })
      : NOT_FOUND,
  [writeKeyOf({
    method: post,
    path: pathFor({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: NEW_PLAYLIST_ID }),
  })]: (body) =>
    isPlaylistTracksChange(body)
      ? ok({
          playlist: {
            ...MIXTAPE,
            id: NEW_PLAYLIST_ID,
            name: 'Road trip',
            trackCount: body.mediaIds.length,
          },
          tracks: [],
        })
      : NOT_FOUND,
}

type AnswerForProps = { method: string; path: string; body: unknown }

/** What the server answers `method` at `path` with, sent `body`. */
const answerFor = ({ method, path, body }: AnswerForProps): Answer => {
  if (method !== APP_CALL_METHODS.get)
    return WRITES[writeKeyOf({ method, path })]?.(body) ?? NOT_FOUND
  const read = ANSWERS[path]
  return read === undefined ? NOT_FOUND : ok(read)
}

const bodyOf = (body: string | undefined): unknown => (body === undefined ? null : JSON.parse(body))

type MusicApiProps = {
  /** Hears every request, writes and reads, as it is made. */
  hear?: (request: HeardRequest) => void
  /** Answers each write once it resolves, so a test can look while the server is busy. */
  writes?: () => Promise<void>
}

/**
 * The test server's music, behind the app's allowlist so an unlisted call fails the test: the
 * music and books libraries, the albums and artists whatever the search, OK Computer's page and
 * Radiohead's, each favourite mark, the account's Mixtape and its edits, the tracks' lyrics and
 * a book's chapters. Each path is answered by itself, its query aside, and keeps no edit.
 */
export const musicApi = ({
  hear = () => undefined,
  writes = async () => undefined,
}: MusicApiProps = {}): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url, init = {}) => {
        const [path = ''] = url.slice(NAS.origin.length).split('?')
        const method = init.method ?? APP_CALL_METHODS.get
        const body = bodyOf(init.body)
        hear({ method, path, body })
        if (method !== APP_CALL_METHODS.get) await writes()
        return responseOf(answerFor({ method, path, body }))
      },
    }),
  })
