import { DISCOVERY_PATHS, HLS_PATHS, PICTURE_PATHS, SCROBBLING_PATHS } from '@/contract'

/** The methods raven's device app sends. */
export const APP_CALL_METHODS = { get: 'GET', put: 'PUT', post: 'POST', delete: 'DELETE' } as const

export type AppCallMethod = (typeof APP_CALL_METHODS)[keyof typeof APP_CALL_METHODS]

/** One route the app may ask for: its method and its path, with the server's `:name` placeholders. */
export type AppClientCall = { method: AppCallMethod; path: string }

const { get, put, post, delete: remove } = APP_CALL_METHODS

/**
 * Every route raven's device app may ask a server for, through PR 10's screens: the
 * `@Public()` and viewer reads, the writes the spec allows (progress, plays, watched, the
 * favourites, the account's playlists, their sharing and copies, and scrobbling links, the PIN), the mixes and radio and the admin lock's unlock, the media ticket and the media plane.
 * A call the `ApiClient` makes is named after its method; the rest are the URLs the native
 * players, pictures and the event stream fetch. Nothing here is `@AdminOnly()` or kept for the
 * owner by the account gate: the server's `appClients.test.ts` checks every entry against its
 * route marks.
 */
export const APP_CLIENT_CALLS = {
  getLock: { method: get, path: '/api/lock' },
  unlock: { method: post, path: '/api/lock/unlock' },
  getAdminLock: { method: get, path: '/api/admin' },
  unlockAdmin: { method: post, path: '/api/admin/unlock' },

  getHome: { method: get, path: '/api/home' },
  searchHome: { method: get, path: '/api/home/search' },
  events: { method: get, path: '/api/events' },
  getPlaybackSettings: { method: get, path: '/api/settings/playback' },
  getDisplaySettings: { method: get, path: '/api/settings/display' },

  listLibraries: { method: get, path: '/api/libraries' },
  getLibrary: { method: get, path: '/api/libraries/:id' },
  listMedia: { method: get, path: '/api/libraries/:id/media' },
  listShows: { method: get, path: '/api/libraries/:id/shows' },
  listSagas: { method: get, path: '/api/libraries/:id/sagas' },
  listInProgress: { method: get, path: '/api/libraries/:id/in-progress' },
  listLibraryFavourites: { method: get, path: '/api/libraries/:id/favourites' },
  listArtists: { method: get, path: '/api/libraries/:id/artists' },
  listAlbums: { method: get, path: '/api/libraries/:id/albums' },
  listTracks: { method: get, path: '/api/libraries/:id/tracks' },
  getAlbum: { method: get, path: '/api/albums/:id' },
  getArtist: { method: get, path: '/api/artists/:id' },
  getLyrics: { method: get, path: '/api/tracks/:id/lyrics' },
  listFavouriteAlbums: { method: get, path: '/api/favourites/albums' },
  listFavouriteArtists: { method: get, path: '/api/favourites/artists' },
  listPlaylists: { method: get, path: '/api/playlists' },
  getPlaylist: { method: get, path: '/api/playlists/:id' },
  listMixes: { method: get, path: DISCOVERY_PATHS.mixes },
  getMix: { method: get, path: DISCOVERY_PATHS.mix },
  getRadio: { method: get, path: DISCOVERY_PATHS.radio },
  getRecentAlbums: { method: get, path: DISCOVERY_PATHS.recent },

  getItem: { method: get, path: '/api/items/:id' },
  nextEpisode: { method: get, path: '/api/items/:id/next' },
  shuffleEpisodes: { method: get, path: '/api/items/:id/shuffle' },
  itemImage: { method: get, path: '/api/items/:id/images/:kind' },
  personPhoto: { method: get, path: '/api/people/:id/photo' },
  itemPicture: { method: get, path: PICTURE_PATHS.item },
  personPicture: { method: get, path: PICTURE_PATHS.photo },
  albumCover: { method: get, path: PICTURE_PATHS.album },

  getMedia: { method: get, path: '/api/media/:id' },
  nextInSession: { method: get, path: '/api/media/:id/next' },
  getTracks: { method: get, path: '/api/media/:id/tracks' },
  getMarkers: { method: get, path: '/api/media/:id/markers' },
  getStreams: { method: get, path: '/api/media/:id/streams' },
  getMediaTicket: { method: get, path: '/api/media/:id/ticket' },
  thumbnail: { method: get, path: '/api/media/:id/thumbnail' },
  getMediaOrigins: { method: get, path: '/api/media-origins' },

  saveProgress: { method: put, path: '/api/media/:id/progress' },
  recordPlay: { method: post, path: '/api/media/:id/plays' },
  setWatched: { method: put, path: '/api/watched' },
  setFavourite: { method: put, path: '/api/media/:id/favourite' },
  setItemFavourite: { method: put, path: '/api/items/:id/favourite' },
  setAlbumFavourite: { method: put, path: '/api/albums/:id/favourite' },
  setArtistFavourite: { method: put, path: '/api/artists/:id/favourite' },
  createPlaylist: { method: post, path: '/api/playlists' },
  renamePlaylist: { method: put, path: '/api/playlists/:id' },
  deletePlaylist: { method: remove, path: '/api/playlists/:id' },
  replacePlaylistTracks: { method: put, path: '/api/playlists/:id/tracks' },
  appendPlaylistTracks: { method: post, path: '/api/playlists/:id/tracks' },
  setPlaylistSharing: { method: put, path: '/api/playlists/:id/sharing' },
  copyPlaylist: { method: post, path: '/api/playlists/:id/copy' },
  getScrobbling: { method: get, path: SCROBBLING_PATHS.root },
  linkListenBrainz: { method: put, path: SCROBBLING_PATHS.listenBrainz },
  startLastFm: { method: post, path: SCROBBLING_PATHS.lastFmStart },
  unlinkScrobbling: { method: remove, path: SCROBBLING_PATHS.service },

  ping: { method: get, path: '/api/media-origins/ping' },
  file: { method: get, path: '/api/media/:id/file' },
  transcode: { method: get, path: '/api/media/:id/transcode' },
  stream: { method: get, path: '/api/media/:id/stream' },
  subtitles: { method: get, path: '/api/media/:id/subtitles/:trackId' },
  hlsMaster: { method: get, path: HLS_PATHS.master },
  hlsVideo: { method: get, path: HLS_PATHS.video },
  hlsInit: { method: get, path: HLS_PATHS.init },
  hlsSegment: { method: get, path: HLS_PATHS.segment },
  hlsSubtitles: { method: get, path: HLS_PATHS.subtitles },
  hlsSubtitleSegment: { method: get, path: HLS_PATHS.subtitleSegment },
} as const satisfies Record<string, AppClientCall>

export type AppClientCallName = keyof typeof APP_CLIENT_CALLS

const PLACEHOLDER = ':'

/** A segment a server or a proxy in front of it may resolve against the ones before it, written plain or escaped. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/iu

const isAppClientCallName = (value: string): value is AppClientCallName =>
  Object.keys(APP_CLIENT_CALLS).includes(value)

/** The path of an address, absolute or already a path: no origin, query or fragment. */
const pathOf = (url: string): string | null => {
  const path = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/iu, '').replace(/[?#].*$/su, '')
  return path.startsWith('/') ? path : null
}

type HasMatchingSegmentsProps = {
  template: readonly string[]
  segments: readonly string[]
}

const hasMatchingSegments = ({ template, segments }: HasMatchingSegmentsProps): boolean =>
  template.length === segments.length &&
  template.every((part, at) =>
    part.startsWith(PLACEHOLDER) ? (segments[at] ?? '') !== '' : part === segments[at],
  )

type AppClientCallOfProps = {
  method: string
  url: string
}

/**
 * Which listed call a request is, or null when it is none. Each `:name` stands for exactly
 * one non-empty path segment; a dot segment never matches, so no path climbs out of one.
 */
export const appClientCallOf = ({
  method,
  url,
}: AppClientCallOfProps): AppClientCallName | null => {
  const path = pathOf(url)
  if (path === null) return null
  const segments = path.split('/')
  if (segments.some((segment) => DOT_SEGMENT.test(segment))) return null
  const names = Object.keys(APP_CLIENT_CALLS).filter(isAppClientCallName)
  return (
    names.find((name) => {
      const call: AppClientCall = APP_CLIENT_CALLS[name]
      return (
        call.method === method && hasMatchingSegments({ template: call.path.split('/'), segments })
      )
    }) ?? null
  )
}
