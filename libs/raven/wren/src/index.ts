/**
 * Wren's words and the facts it works out from raven's answers, with no React, React Native,
 * Expo or DOM in them, so the phone app and the web app say and compute the same from one source.
 */
export {
  DOWNLOAD_BUTTON_COPY,
  DOWNLOAD_COPY,
  TRACK_MENU_COPY,
  WREN_LOCKUP_COPY,
} from '@/copy/components'
export {
  COUNTS_COPY,
  KIT_COPY,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
  STATUS_COPY,
  TAB_COPY,
  factsLineOf,
} from '@/copy/kit'
export {
  ALBUM_COPY,
  ARTIST_COPY,
  DETAIL_COPY,
  HOME_COPY,
  LIBRARY_COPY,
  LIBRARY_PAGE_COPY,
  NOW_PLAYING_COPY,
  OFFLINE_COPY,
  PLAYLIST_COPY,
  SEARCH_COPY,
  SETTINGS_COPY,
  SIGN_IN_COPY,
  STORAGE_COPY,
} from '@/copy/screens'
export { countValueOf, countsLineOf, lineValueOf } from '@/counts'
export { albumMetaOf, artistMetaOf, playlistMetaOf } from '@/detailFacts'
export { detailNoticeOf } from '@/detailNotice'
export { greetingOf } from '@/greeting'
export { INDEX_LETTERS, firstAtLetter } from '@/library/artistIndex'
export {
  type ListState,
  emptyCopyOf,
  listNoticeOf,
  listStateOf,
  mergedOf,
  queryListStateOf,
  songCountOf,
} from '@/library/listState'
export { albumsByTitle, artistsByName } from '@/library/order'
export { PLAYLIST_STATES, type PlaylistState, playlistsStateOf } from '@/library/playlistStates'
export { LIBRARY_SEGMENTS, type LibrarySegment } from '@/library/segments'
export {
  LIST_SORTS,
  LIST_SORT_LABELS,
  LIST_SORT_ORDER,
  type ListSort,
  RECENT_SERVER_SORTS,
  SERVER_SORTS,
  matchingAlbums,
  matchingArtists,
  recentAlbums,
  sortedAlbums,
} from '@/library/sorts'
export { nextPageOf, tracksOfPages } from '@/nextPage'
export { oneOfOr } from '@/oneOfOr'
export {
  LYRIC_TONES,
  type LyricTone,
  PANES,
  type Pane,
  type SourceTitle,
  type UpNextRow,
  barWordsOf,
  lyricOffsetOf,
  lyricToneOf,
  paneAfter,
  placesToClearOf,
  shownLyricsOf,
  sourceIdOf,
  sourceTitleOf,
  upNextRowsOf,
} from '@/nowPlaying/nowPlayingModel'
export { qualityLineOf } from '@/nowPlaying/quality'
export {
  STEPS,
  type Step,
  TRANSPORTS,
  type TransportKind,
  hasTogglesOf,
  progressOf,
  remainingTextOf,
  scrubTextOf,
} from '@/playerModel'
export {
  APPEARANCES,
  type Appearance,
  RECENT_SORTS,
  type RecentSort,
  WREN_PREFS_KEY,
  isAppearance,
  isRecentSort,
} from '@/prefs'
export {
  RECENT_KINDS,
  RECENT_SEARCHES_KEY,
  type RecentSearch,
  mergedRecentsOf,
  recentKeyOf,
  recentOfAlbum,
  recentOfArtist,
  recentTextOf,
  withRecent,
  withoutRecent,
} from '@/search/recentSearches'
export { RESULT_STATES, type ResultState, resultStateOf } from '@/search/resultStates'
export {
  ALBUMS_IN_ALL,
  FILTER_CHIPS,
  FILTER_LABELS,
  SEARCH_FILTERS,
  SONGS_IN_ALL,
  type SearchFilter,
} from '@/search/searchFilters'
export { signInErrorsOf } from '@/signIn/signInErrors'
export { type MenuPlaces, menuGroupsOf } from '@/menuGroups'
export { SONG_LEADS, type SongLead, type SongLeadOf, songLeadOf } from '@/songLead'
export { TOP_RESULT_KINDS, type TopResult, topResultOf } from '@/search/topResult'
