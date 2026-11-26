import { type Route, ROUTES } from '@/routes'

/** One route the app may ask for: its method and its path, with the server's `:name` placeholders. */
export type AppClientCall = Pick<Route, 'method' | 'path'>

/**
 * The routes the server keeps for the owner that the app calls, and only for the signed-in
 * account `GET /api/me` names the owner: the web's Admin page, as the owner asked for it on
 * every device, and a video's Delete on its card's menu. The server stays the authority: each
 * answers 403 to anyone else.
 */
export const APP_OWNER_CALLS = {
  setPlaybackSettings: ROUTES.setPlaybackSettings,
  setDisplaySettings: ROUTES.setDisplaySettings,
  getRemoteAccess: ROUTES.getRemoteAccess,
  listMembers: ROUTES.listMembers,
  setMemberStatus: ROUTES.setMemberStatus,
  quickScanLibrary: ROUTES.quickScanLibrary,
  cancelQuickScan: ROUTES.cancelQuickScan,
  scanLibrary: ROUTES.scanLibrary,
  cancelScan: ROUTES.cancelScan,
  scanLibraryMarkers: ROUTES.scanLibraryMarkers,
  mergeLibraryAlbums: ROUTES.mergeLibraryAlbums,
  updateLibraryRatings: ROUTES.updateLibraryRatings,
  cancelLibraryRatings: ROUTES.cancelLibraryRatings,
  matchLibrary: ROUTES.matchLibrary,
  listArtistBackgrounds: ROUTES.listArtistBackgrounds,
  setArtistBackground: ROUTES.setArtistBackground,
  listEveryonesRequests: ROUTES.listEveryonesRequests,
  deleteMedia: ROUTES.deleteMedia,
} as const satisfies Record<string, AppClientCall>

/**
 * Every route raven's device app may ask a server for, through PR 10's screens: the
 * `@Public()` and viewer reads, the writes the spec allows (progress, plays, watched, the
 * favourites, the account's playlists, their sharing and copies, scrobbling links, the binge
 * list and a Coming soon title's request), the mixes and radio, the admin lock's unlock, the PIN's unlock and lock (only the owner
 * unlocks; the server answers anyone else's PIN with its refusal), the media ticket, the MP4 copy
 * a download asks for when the device cannot play the original, and the media plane.
 * A call the `ApiClient` makes is named after its method; the rest are the URLs the native
 * players, pictures and the event stream fetch. The only entries the server keeps for the owner
 * (`@AdminOnly()`, or the account gate's owner) are `APP_OWNER_CALLS`'s: the server's
 * `appClients.test.ts` checks every entry against its route marks.
 */
export const APP_CLIENT_CALLS = {
  getLock: ROUTES.getLock,
  unlock: ROUTES.unlock,
  lock: ROUTES.lock,
  getAdminLock: ROUTES.getAdminLock,
  unlockAdmin: ROUTES.unlockAdmin,

  getMe: ROUTES.getMe,

  getHome: ROUTES.getHome,
  getHero: ROUTES.getHero,
  getHomeAlbums: ROUTES.getHomeAlbums,
  searchHome: ROUTES.searchHome,
  events: ROUTES.events,
  getPlaybackSettings: ROUTES.getPlaybackSettings,
  getDisplaySettings: ROUTES.getDisplaySettings,

  listLibraries: ROUTES.listLibraries,
  getLibrary: ROUTES.getLibrary,
  listMedia: ROUTES.listMedia,
  listShows: ROUTES.listShows,
  listSagas: ROUTES.listSagas,
  listInProgress: ROUTES.listInProgress,
  listLibraryFavourites: ROUTES.listLibraryFavourites,
  listLibraryFavouriteTitles: ROUTES.listLibraryFavouriteTitles,
  listHistory: ROUTES.listHistory,
  listArtists: ROUTES.listArtists,
  listAlbums: ROUTES.listAlbums,
  listTracks: ROUTES.listTracks,
  getAlbum: ROUTES.getAlbum,
  getArtist: ROUTES.getArtist,
  getArtistAbout: ROUTES.getArtistAbout,
  getLyrics: ROUTES.getLyrics,
  listFavourites: ROUTES.listFavourites,
  listFavouriteTitles: ROUTES.listFavouriteTitles,
  listFavouriteAlbums: ROUTES.listFavouriteAlbums,
  listFavouriteArtists: ROUTES.listFavouriteArtists,
  getBinge: ROUTES.getBinge,
  listPlaylists: ROUTES.listPlaylists,
  getPlaylist: ROUTES.getPlaylist,
  listMixes: ROUTES.listMixes,
  getMix: ROUTES.getMix,
  getRadio: ROUTES.getRadio,
  getRecentAlbums: ROUTES.getRecentAlbums,

  getUpcoming: ROUTES.getUpcoming,
  getUpcomingDetails: ROUTES.getUpcomingDetails,
  listRequests: ROUTES.listRequests,
  getRequestHolding: ROUTES.getRequestHolding,
  requestDownload: ROUTES.requestDownload,
  cachedImage: ROUTES.cachedImage,

  getItem: ROUTES.getItem,
  nextEpisode: ROUTES.nextEpisode,
  shuffleEpisodes: ROUTES.shuffleEpisodes,
  itemImage: ROUTES.itemImage,
  personPhoto: ROUTES.personPhoto,
  itemPicture: ROUTES.itemPicture,
  personPicture: ROUTES.personPicture,
  artistPicture: ROUTES.artistPicture,
  artistBackgroundPicture: ROUTES.artistBackgroundPicture,
  albumCover: ROUTES.albumCover,

  getMedia: ROUTES.getMedia,
  nextInSession: ROUTES.nextInSession,
  getTracks: ROUTES.getTracks,
  getMarkers: ROUTES.getMarkers,
  getStreams: ROUTES.getStreams,
  getMediaTicket: ROUTES.getMediaTicket,
  thumbnail: ROUTES.thumbnail,
  getMediaOrigins: ROUTES.getMediaOrigins,
  getDeviceDownload: ROUTES.getDeviceDownload,

  saveProgress: ROUTES.saveProgress,
  recordPlay: ROUTES.recordPlay,
  startListen: ROUTES.startListen,
  reportListen: ROUTES.reportListen,
  setWatched: ROUTES.setWatched,
  setFavourite: ROUTES.setFavourite,
  setItemFavourite: ROUTES.setItemFavourite,
  setAlbumFavourite: ROUTES.setAlbumFavourite,
  setArtistFavourite: ROUTES.setArtistFavourite,
  setBinge: ROUTES.setBinge,
  createPlaylist: ROUTES.createPlaylist,
  renamePlaylist: ROUTES.renamePlaylist,
  deletePlaylist: ROUTES.deletePlaylist,
  replacePlaylistTracks: ROUTES.replacePlaylistTracks,
  appendPlaylistTracks: ROUTES.appendPlaylistTracks,
  setPlaylistSharing: ROUTES.setPlaylistSharing,
  copyPlaylist: ROUTES.copyPlaylist,
  getScrobbling: ROUTES.getScrobbling,
  linkListenBrainz: ROUTES.linkListenBrainz,
  startLastFm: ROUTES.startLastFm,
  unlinkScrobbling: ROUTES.unlinkScrobbling,

  ping: ROUTES.ping,
  file: ROUTES.file,
  transcode: ROUTES.transcode,
  deviceDownloadFile: ROUTES.deviceDownloadFile,
  stream: ROUTES.stream,
  subtitles: ROUTES.subtitles,
  hlsMaster: ROUTES.hlsMaster,
  hlsVideo: ROUTES.hlsVideo,
  hlsInit: ROUTES.hlsInit,
  hlsSegment: ROUTES.hlsSegment,
  hlsSubtitles: ROUTES.hlsSubtitles,
  hlsSubtitleSegment: ROUTES.hlsSubtitleSegment,

  ...APP_OWNER_CALLS,
} as const satisfies Record<string, AppClientCall>

export type AppClientCallName = keyof typeof APP_CLIENT_CALLS

const PLACEHOLDER = ':'

/** A segment a server or a proxy in front of it may resolve against the ones before it, written plain or escaped. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/iu

const isAppClientCallName = (value: string): value is AppClientCallName =>
  Object.hasOwn(APP_CLIENT_CALLS, value)

type CallTemplate = Pick<AppClientCall, 'method'> & {
  name: AppClientCallName
  template: readonly string[]
}

/*
 * Every call's method and path segments, split once. The match runs for every picture a screen
 * draws and every fetch, and on a TV's Hermes building this for each one held Home's first
 * render for seconds.
 */
const CALL_TEMPLATES: readonly CallTemplate[] = Object.keys(APP_CLIENT_CALLS)
  .filter(isAppClientCallName)
  .map((name) => {
    const call: AppClientCall = APP_CLIENT_CALLS[name]
    return { name, method: call.method, template: call.path.split('/') }
  })

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
  return (
    CALL_TEMPLATES.find(
      (call) =>
        call.method === method && hasMatchingSegments({ template: call.template, segments }),
    )?.name ?? null
  )
}
