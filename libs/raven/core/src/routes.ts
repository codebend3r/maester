import {
  AUTH_PATHS,
  BUG_REPORT_PATHS,
  CAPTION_PATHS,
  DEVICE_DOWNLOAD_PATHS,
  DISCOVERY_PATHS,
  HLS_PATHS,
  HTTP_METHODS,
  NOTIFICATION_PATHS,
  PICTURE_PATHS,
  PLAY_HISTORY_PATHS,
  REMOTE_ACCESS_PATHS,
  SCAN_CONTROL_PATH,
  SCROBBLING_PATHS,
  UPCOMING_PATH,
  UPCOMING_SHELF_PATH,
  isAccount,
  isAccountList,
  isAdminLock,
  isAlbumDetails,
  isAlbumList,
  isAlbumMatchCandidateList,
  isAlbumMerge,
  isAlbumShelves,
  isArtistDetails,
  isArtistList,
  isAuthConfig,
  isBingeState,
  isBugReport,
  isBugReportList,
  isCaptionStyle,
  isDeviceDownload,
  isDirectoryListing,
  isDisplaySettings,
  isDolbyVisionOnlyListing,
  isDuplicates,
  isFavouriteTitles,
  isHero,
  isHeroPicks,
  isHistory,
  isHome,
  isHomeSearch,
  isItemDetails,
  isItemImageOptions,
  isItemMetadataState,
  isLastFmAuthPage,
  isLibrary,
  isLibraryCounts,
  isLibraryList,
  isListenStarted,
  isLiveStreamList,
  isLockState,
  isLyrics,
  isMatchCandidateList,
  isMediaItem,
  isMediaList,
  isMediaLocation,
  isMediaMarkers,
  isMediaOrigins,
  isMediaStreams,
  isMediaTicket,
  isMediaTracks,
  isMixDetails,
  isMixList,
  isNotification,
  isNotificationList,
  isPersonDetails,
  isPlayHistoryPage,
  isPlaybackSettingsState,
  isPlaylistDetails,
  isPlaylistList,
  isPosterEntries,
  isRadioTracks,
  isRecentAlbums,
  isRemoteAccessState,
  isSagaBackdrop,
  isSagaList,
  isScanControlState,
  isScrobbleStatusList,
  isServerHealth,
  isShowListing,
  isSmartMatchStarted,
  isTrackPage,
  isUnmatchedList,
  isUpcoming,
  isUpcomingPage,
  isTitleRequest,
  isTitleHolding,
  isTitleRequests,
  isUpcomingDetails,
  REQUEST_HOLDING_PATH,
  REQUEST_PATHS,
  UPCOMING_TITLE_PATH,
} from '@/contract'
import { fillPath } from '@/query'
import { type Guard, nullable } from '@/schema'

/** An HTTP method a raven route answers. */
export type RouteMethod = (typeof HTTP_METHODS)[keyof typeof HTTP_METHODS]

/**
 * One route of the server's API: its method, its path with the server's
 * `:name` placeholders, and the guard its JSON answer passes, or null for a
 * route that answers bytes, text or nothing a client reads.
 */
export type Route = {
  method: RouteMethod
  path: `/api/${string}`
  reply: Guard<unknown> | null
}

const { get, put, post, delete: remove } = HTTP_METHODS

/**
 * Every route a raven client calls, by the name of the call. The API client,
 * the device app's allowlist (`APP_CLIENT_CALLS`), the desktop's allowlist and
 * the test servers all read their methods and paths from here, so a route is
 * written once.
 */
export const ROUTES = {
  getAuthConfig: { method: get, path: AUTH_PATHS.config, reply: isAuthConfig },
  getMe: { method: get, path: AUTH_PATHS.me, reply: isAccount },
  listMembers: { method: get, path: AUTH_PATHS.members, reply: isAccountList },
  setMemberStatus: { method: post, path: AUTH_PATHS.memberStatus, reply: isAccount },
  getAccountMediaTicket: { method: post, path: AUTH_PATHS.ticket, reply: isMediaTicket },

  getLock: { method: get, path: '/api/lock', reply: isLockState },
  unlock: { method: post, path: '/api/lock/unlock', reply: isLockState },
  lock: { method: post, path: '/api/lock/lock', reply: isLockState },
  getAdminLock: { method: get, path: '/api/admin', reply: isAdminLock },
  unlockAdmin: { method: post, path: '/api/admin/unlock', reply: isAdminLock },
  lockAdmin: { method: post, path: '/api/admin/lock', reply: isAdminLock },
  keepAdminUnlocked: { method: post, path: '/api/admin/keep-unlocked', reply: isAdminLock },

  listLibraries: { method: get, path: '/api/libraries', reply: isLibraryList },
  createLibrary: { method: post, path: '/api/libraries', reply: isLibrary },
  reorderLibraries: { method: put, path: '/api/libraries/order', reply: null },
  getLibrary: { method: get, path: '/api/libraries/:id', reply: isLibrary },
  updateLibrary: { method: put, path: '/api/libraries/:id', reply: isLibrary },
  deleteLibrary: { method: remove, path: '/api/libraries/:id', reply: null },
  setLibraryView: { method: put, path: '/api/libraries/:id/view', reply: isLibrary },
  setLibraryInHero: { method: put, path: '/api/libraries/:id/hero', reply: isLibrary },
  scanLibraryMarkers: { method: post, path: '/api/libraries/:id/markers', reply: isLibrary },
  scanLibrary: { method: post, path: '/api/libraries/:id/scan', reply: isLibrary },
  cancelScan: { method: post, path: '/api/libraries/:id/scan/cancel', reply: isLibrary },
  quickScanLibrary: { method: post, path: '/api/libraries/:id/quick-scan', reply: isLibrary },
  cancelQuickScan: {
    method: post,
    path: '/api/libraries/:id/quick-scan/cancel',
    reply: isLibrary,
  },
  updateLibraryRatings: { method: post, path: '/api/libraries/:id/ratings', reply: isLibrary },
  cancelLibraryRatings: {
    method: post,
    path: '/api/libraries/:id/ratings/cancel',
    reply: isLibrary,
  },
  matchLibrary: { method: post, path: '/api/libraries/:id/match', reply: isLibrary },
  mergeLibraryAlbums: {
    method: post,
    path: '/api/libraries/:id/albums/merge',
    reply: isAlbumMerge,
  },
  smartMatchAlbums: {
    method: post,
    path: '/api/libraries/:id/albums/smart-match',
    reply: isSmartMatchStarted,
  },
  listMedia: { method: get, path: '/api/libraries/:id/media', reply: isMediaList },
  listShows: { method: get, path: '/api/libraries/:id/shows', reply: isShowListing },
  getLibraryCounts: { method: get, path: '/api/libraries/:id/counts', reply: isLibraryCounts },
  listInProgress: { method: get, path: '/api/libraries/:id/in-progress', reply: isPosterEntries },
  listLibraryFavourites: {
    method: get,
    path: '/api/libraries/:id/favourites',
    reply: isPosterEntries,
  },
  listLibraryFavouriteTitles: {
    method: get,
    path: '/api/libraries/:id/favourites/titles',
    reply: isFavouriteTitles,
  },
  listSagas: { method: get, path: '/api/libraries/:id/sagas', reply: isSagaList },
  setSagaBackdrop: {
    method: put,
    path: '/api/libraries/:id/sagas/:sagaId/backdrop',
    reply: isSagaBackdrop,
  },
  listUnmatched: { method: get, path: '/api/libraries/:id/unmatched', reply: isUnmatchedList },
  listDolbyVisionOnly: {
    method: get,
    path: '/api/libraries/:id/dolby-vision',
    reply: isDolbyVisionOnlyListing,
  },
  listDuplicates: { method: get, path: '/api/libraries/:id/duplicates', reply: isDuplicates },
  splitDuplicate: {
    method: post,
    path: '/api/libraries/:id/duplicates/split',
    reply: isDuplicates,
  },
  joinSplit: { method: post, path: '/api/libraries/:id/duplicates/join', reply: isDuplicates },
  listHistory: { method: get, path: '/api/libraries/:id/history', reply: isHistory },
  listArtists: { method: get, path: '/api/libraries/:id/artists', reply: isArtistList },
  listAlbums: { method: get, path: '/api/libraries/:id/albums', reply: isAlbumList },
  listTracks: { method: get, path: '/api/libraries/:id/tracks', reply: isTrackPage },
  browse: { method: get, path: '/api/fs/browse', reply: isDirectoryListing },

  getMedia: { method: get, path: '/api/media/:id', reply: isMediaItem },
  deleteMedia: { method: remove, path: '/api/media/:id', reply: null },
  nextInSession: { method: get, path: '/api/media/:id/next', reply: nullable(isMediaItem) },
  getMarkers: { method: get, path: '/api/media/:id/markers', reply: isMediaMarkers },
  getMediaLocation: { method: get, path: '/api/media/:id/location', reply: isMediaLocation },
  saveProgress: { method: put, path: '/api/media/:id/progress', reply: null },
  setFavourite: { method: put, path: '/api/media/:id/favourite', reply: isMediaItem },
  recordPlay: { method: post, path: '/api/media/:id/plays', reply: null },
  setMatch: { method: put, path: '/api/media/:id/match', reply: isMediaItem },
  getTracks: { method: get, path: '/api/media/:id/tracks', reply: isMediaTracks },
  getStreams: { method: get, path: '/api/media/:id/streams', reply: isMediaStreams },
  getMediaTicket: { method: get, path: '/api/media/:id/ticket', reply: isMediaTicket },
  getDeviceDownload: { method: get, path: DEVICE_DOWNLOAD_PATHS.prepare, reply: isDeviceDownload },
  setWatched: { method: put, path: '/api/watched', reply: null },
  getMediaOrigins: { method: get, path: '/api/media-origins', reply: isMediaOrigins },

  getItem: { method: get, path: '/api/items/:id', reply: isItemDetails },
  refreshItem: { method: post, path: '/api/items/:id/refresh', reply: isItemDetails },
  setItemFavourite: { method: put, path: '/api/items/:id/favourite', reply: isItemDetails },
  nextEpisode: { method: get, path: '/api/items/:id/next', reply: nullable(isMediaItem) },
  shuffleEpisodes: { method: get, path: '/api/items/:id/shuffle', reply: isMediaList },
  setItemMatch: { method: put, path: '/api/items/:id/match', reply: isItemDetails },
  getItemMetadata: { method: get, path: '/api/items/:id/metadata', reply: isItemMetadataState },
  setItemMetadata: { method: put, path: '/api/items/:id/metadata', reply: isItemDetails },
  getItemImages: { method: get, path: '/api/items/:id/images', reply: isItemImageOptions },
  chooseItemImage: { method: put, path: '/api/items/:id/images/:kind', reply: isItemDetails },
  getPerson: { method: get, path: '/api/people/:id', reply: isPersonDetails },

  getHome: { method: get, path: '/api/home', reply: isHome },
  searchHome: { method: get, path: '/api/home/search', reply: isHomeSearch },
  getHero: { method: get, path: '/api/home/hero', reply: isHero },
  getHomeAlbums: { method: get, path: '/api/home/albums', reply: isAlbumShelves },
  getHeroPicks: { method: get, path: '/api/hero/picks', reply: isHeroPicks },
  setHeroPick: { method: put, path: '/api/hero/picks', reply: isHeroPicks },
  getUpcoming: { method: get, path: UPCOMING_PATH, reply: isUpcoming },
  getUpcomingShelf: { method: get, path: UPCOMING_SHELF_PATH, reply: isUpcomingPage },
  getUpcomingDetails: { method: get, path: UPCOMING_TITLE_PATH, reply: isUpcomingDetails },
  listRequests: { method: get, path: REQUEST_PATHS.requests, reply: isTitleRequests },
  getRequestHolding: { method: get, path: REQUEST_HOLDING_PATH, reply: isTitleHolding },
  requestDownload: { method: post, path: REQUEST_PATHS.requests, reply: isTitleRequest },
  listFavourites: { method: get, path: '/api/favourites', reply: isPosterEntries },
  listFavouriteTitles: { method: get, path: '/api/favourites/titles', reply: isFavouriteTitles },
  listFavouriteAlbums: { method: get, path: '/api/favourites/albums', reply: isAlbumList },
  listFavouriteArtists: { method: get, path: '/api/favourites/artists', reply: isArtistList },

  listPlayHistory: { method: get, path: PLAY_HISTORY_PATHS.own, reply: isPlayHistoryPage },
  listEveryonesHistory: {
    method: get,
    path: PLAY_HISTORY_PATHS.everyone,
    reply: isPlayHistoryPage,
  },
  startListen: { method: post, path: PLAY_HISTORY_PATHS.startListen, reply: isListenStarted },
  reportListen: { method: put, path: PLAY_HISTORY_PATHS.listen, reply: null },

  searchMatches: { method: get, path: '/api/match/search', reply: isMatchCandidateList },
  getServerHealth: { method: get, path: '/api/health', reply: isServerHealth },

  getBinge: { method: get, path: '/api/binge', reply: isBingeState },
  dismissBingeTip: { method: put, path: '/api/binge/tip', reply: isBingeState },
  setBinge: { method: put, path: '/api/binge/:id', reply: isBingeState },
  getCaptionStyle: { method: get, path: CAPTION_PATHS.style, reply: isCaptionStyle },
  setCaptionStyle: { method: put, path: CAPTION_PATHS.style, reply: isCaptionStyle },

  getAlbum: { method: get, path: '/api/albums/:id', reply: isAlbumDetails },
  searchAlbumMatches: {
    method: get,
    path: '/api/albums/:id/match/search',
    reply: isAlbumMatchCandidateList,
  },
  setAlbumMatch: { method: put, path: '/api/albums/:id/match', reply: isAlbumDetails },
  setAlbumFavourite: { method: put, path: '/api/albums/:id/favourite', reply: isAlbumDetails },
  getArtist: { method: get, path: '/api/artists/:id', reply: isArtistDetails },
  setArtistFavourite: { method: put, path: '/api/artists/:id/favourite', reply: isArtistDetails },
  getLyrics: { method: get, path: '/api/tracks/:id/lyrics', reply: isLyrics },

  listPlaylists: { method: get, path: '/api/playlists', reply: isPlaylistList },
  createPlaylist: { method: post, path: '/api/playlists', reply: isPlaylistDetails },
  getPlaylist: { method: get, path: '/api/playlists/:id', reply: isPlaylistDetails },
  renamePlaylist: { method: put, path: '/api/playlists/:id', reply: isPlaylistDetails },
  deletePlaylist: { method: remove, path: '/api/playlists/:id', reply: null },
  replacePlaylistTracks: {
    method: put,
    path: '/api/playlists/:id/tracks',
    reply: isPlaylistDetails,
  },
  appendPlaylistTracks: {
    method: post,
    path: '/api/playlists/:id/tracks',
    reply: isPlaylistDetails,
  },
  setPlaylistSharing: {
    method: put,
    path: '/api/playlists/:id/sharing',
    reply: isPlaylistDetails,
  },
  copyPlaylist: { method: post, path: '/api/playlists/:id/copy', reply: isPlaylistDetails },

  listMixes: { method: get, path: DISCOVERY_PATHS.mixes, reply: isMixList },
  getMix: { method: get, path: DISCOVERY_PATHS.mix, reply: isMixDetails },
  getRadio: { method: get, path: DISCOVERY_PATHS.radio, reply: isRadioTracks },
  getRecentAlbums: { method: get, path: DISCOVERY_PATHS.recent, reply: isRecentAlbums },

  getScrobbling: { method: get, path: SCROBBLING_PATHS.root, reply: isScrobbleStatusList },
  linkListenBrainz: {
    method: put,
    path: SCROBBLING_PATHS.listenBrainz,
    reply: isScrobbleStatusList,
  },
  startLastFm: { method: post, path: SCROBBLING_PATHS.lastFmStart, reply: isLastFmAuthPage },
  unlinkScrobbling: {
    method: remove,
    path: SCROBBLING_PATHS.service,
    reply: isScrobbleStatusList,
  },

  getScanControl: { method: get, path: SCAN_CONTROL_PATH, reply: isScanControlState },
  setScanControl: { method: put, path: SCAN_CONTROL_PATH, reply: isScanControlState },
  getPlaybackSettings: {
    method: get,
    path: '/api/settings/playback',
    reply: isPlaybackSettingsState,
  },
  setPlaybackSettings: {
    method: put,
    path: '/api/settings/playback',
    reply: isPlaybackSettingsState,
  },
  getDisplaySettings: { method: get, path: '/api/settings/display', reply: isDisplaySettings },
  setDisplaySettings: { method: put, path: '/api/settings/display', reply: isDisplaySettings },
  getRemoteAccess: {
    method: get,
    path: REMOTE_ACCESS_PATHS.settings,
    reply: isRemoteAccessState,
  },
  setRemoteAccess: {
    method: put,
    path: REMOTE_ACCESS_PATHS.settings,
    reply: isRemoteAccessState,
  },

  reportPlaybackError: { method: post, path: BUG_REPORT_PATHS.reports, reply: isBugReport },
  listBugReports: { method: get, path: BUG_REPORT_PATHS.reports, reply: isBugReportList },
  setBugReportStatus: { method: put, path: BUG_REPORT_PATHS.status, reply: isBugReport },
  listNotifications: { method: get, path: NOTIFICATION_PATHS.own, reply: isNotificationList },
  logNotification: { method: post, path: NOTIFICATION_PATHS.own, reply: isNotification },
  listLiveStreams: { method: get, path: '/api/streams', reply: isLiveStreamList },
  stopStream: { method: post, path: '/api/streams/:id/stop', reply: null },

  // What a player, a picture or the event stream fetches by address rather than as JSON.
  events: { method: get, path: '/api/events', reply: null },
  thumbnail: { method: get, path: '/api/media/:id/thumbnail', reply: null },
  itemImage: { method: get, path: '/api/items/:id/images/:kind', reply: null },
  localItemImage: { method: get, path: '/api/items/:id/images/:kind/local', reply: null },
  personPhoto: { method: get, path: '/api/people/:id/photo', reply: null },
  reviewAvatar: { method: get, path: '/api/reviews/:id/avatar', reply: null },
  itemPicture: { method: get, path: PICTURE_PATHS.item, reply: null },
  personPicture: { method: get, path: PICTURE_PATHS.photo, reply: null },
  artistPicture: { method: get, path: PICTURE_PATHS.artist, reply: null },
  albumCover: { method: get, path: PICTURE_PATHS.album, reply: null },
  ping: { method: get, path: '/api/media-origins/ping', reply: null },
  file: { method: get, path: '/api/media/:id/file', reply: null },
  transcode: { method: get, path: '/api/media/:id/transcode', reply: null },
  deviceDownloadFile: { method: get, path: DEVICE_DOWNLOAD_PATHS.file, reply: null },
  stream: { method: get, path: '/api/media/:id/stream', reply: null },
  subtitles: { method: get, path: '/api/media/:id/subtitles/:trackId', reply: null },
  hlsMaster: { method: get, path: HLS_PATHS.master, reply: null },
  hlsVideo: { method: get, path: HLS_PATHS.video, reply: null },
  hlsInit: { method: get, path: HLS_PATHS.init, reply: null },
  hlsSegment: { method: get, path: HLS_PATHS.segment, reply: null },
  hlsSubtitles: { method: get, path: HLS_PATHS.subtitles, reply: null },
  hlsSubtitleSegment: { method: get, path: HLS_PATHS.subtitleSegment, reply: null },
} as const satisfies Record<string, Route>

export type RouteName = keyof typeof ROUTES

/** The `:name` placeholders of a route's path. */
export type PathParamName<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParamName<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never

/** The values a path's placeholders take; nothing for a path with none. */
export type PathParams<P extends string> = Readonly<Record<PathParamName<P>, string | number>>

type PathForProps<P extends string> = {
  path: P
  params: PathParams<P>
}

/** A route's path with every placeholder filled in, each value escaped: `/api/media/:id` to `/api/media/7`. */
export const pathFor = <P extends string>({ path, params }: PathForProps<P>): string =>
  fillPath({ path, params })
