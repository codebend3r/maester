/**
 * Wren's words, its colours and the facts it works out from raven's answers, with no React,
 * React Native, Expo or DOM in them, so the phone, TV and web apps say, paint and compute the
 * same from one source.
 */
export {
  DOWNLOAD_BUTTON_COPY,
  DOWNLOAD_COPY,
  TRACK_MENU_COPY,
  WREN_LOCKUP_COPY,
} from '@/copy/components'
export { DESIGN_COPY } from '@/copy/design'
export { isLibraryPick, wornLibrariesOf } from '@/library/wornLibrary'
export {
  COUNTS_COPY,
  KIT_COPY,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
  SIDEBAR_COPY,
  SIDEBAR_KEY,
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
  TOP_SHELF_COPY,
} from '@/copy/screens'
export { NAME_SAVES, type ServerNameSave, serverNameSaveOf } from '@/serverName'
export { themePickerLabelOf, themeSlotLabelOf } from '@/themePickerLabel'
export { aboutFactsOf, hasAbout } from '@/artistAbout'
export { countValueOf, countsLineOf, lineValueOf } from '@/counts'
export { albumMetaOf, artistMetaOf, playlistMetaOf } from '@/detailFacts'
export { detailNoticeOf } from '@/detailNotice'
export { greetingOf } from '@/greeting'
export { firstAtLetter } from '@/library/artistIndex'
export { favouritesOf } from '@/library/favourites'
export {
  type ListState,
  emptyCopyOf,
  isListLoading,
  listNoticeOf,
  listStateOf,
  mergedOf,
  queryListStateOf,
  songCountOf,
} from '@/library/listState'
export { albumsByTitle, artistsByName } from '@/library/order'
export { PLAYLIST_STATES, type PlaylistState, playlistsStateOf } from '@/library/playlistStates'
export { FINISHED_SHOWN, libraryValuesOf } from '@/library/libraryCounts'
export {
  albumIdsOf,
  inLibraryOrder,
  listedTracksOf,
  recentlyFinished,
  unmatchedAlbumsOf,
} from '@/library/listedTracks'
export {
  LIBRARY_ICONS,
  LIBRARY_LABELS,
  LIBRARY_ORDER,
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  SHARED_ORDER,
  type SharedSegment,
} from '@/library/segments'
export {
  FIRST_LIST_ORDER,
  type ListOrder,
  RECENT_SERVER_SORTS,
  listOrderOf,
  matchingAlbums,
  matchingArtists,
  recentAlbums,
  sortedAlbums,
} from '@/library/sorts'
export { recentDateLineOf } from '@/library/recentDates'
export { nextPageOf, tracksOfPages } from '@/nextPage'
export {
  LYRIC_TONES,
  type LyricTone,
  PANES,
  type Pane,
  type SourceTitle,
  SIDE_PANE_CHOICES,
  type SidePane,
  type UpNextRow,
  barWordsOf,
  lyricOffsetOf,
  lyricToneOf,
  paneAfter,
  placesToClearOf,
  SHOWN_LYRICS_KINDS,
  type ShownLyrics,
  shownLyricsOf,
  sourceIdOf,
  sourceTitleOf,
  upNextRowsOf,
} from '@/nowPlaying/nowPlayingModel'
export { type QualityView, qualityViewOf } from '@/nowPlaying/quality'
export {
  SCRUB_STEP_SECONDS,
  STEPS,
  type Step,
  TRANSPORTS,
  type TransportKind,
  progressOf,
  repeatIconOf,
  scrubTextOf,
  toggleLookOf,
} from '@/playerModel'
export {
  COVER_SIZES,
  type CoverSize,
  DEFAULT_SHARED_PREFS,
  isCoverSize,
  RECENT_SORTS,
  type RecentSort,
  WREN_PREFS_KEY,
  WREN_PREFS_VERSION,
  type WrenSharedPrefs,
  isRecentSort,
  sharedPrefsOf,
} from '@/prefs'
export {
  COLOR_SCHEMES,
  type ColorScheme,
  DEFAULT_THEME_CHOICE,
  THEME_MODES,
  THEME_SCHEMES,
  type ThemeChoice,
  type ThemeMode,
  WREN_THEMES,
  type WrenThemeName,
  themeChoiceIn,
  themeFor,
  systemSchemeOf,
  themeChoiceOf,
  withThemePicked,
} from '@/themes'
export {
  RECENT_KINDS,
  RECENT_SEARCHES_KEY,
  type RecentPage,
  type RecentSearch,
  isRecentPage,
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
export { TOAST_MS } from '@/toast'
export {
  MENU_VIEWS,
  type MenuLike,
  type MenuPlaces,
  type MenuView,
  type SongActions,
  menuGroupsOf,
} from '@/menuGroups'
export { SONG_LEADS, type ShownLead, type SongLead, type SongLeadOf, songLeadOf } from '@/songLead'
export { TOP_RESULT_KINDS, type TopResult, topResultOf } from '@/search/topResult'
export { ART, BRAND, ON_PICTURE, type Palette, WREN_PALETTES } from '@/palettes'
export {
  COVER_SIZE_OPTIONS,
  HOME_RECENT_CHOICES,
  HOME_RECENT_TITLES,
  MUSIC_SORT_OPTIONS,
} from '@/choices'
export { type Drawing, INKS, WREN_ICONS, type WrenIconName } from '@/icons'
export { BRAND_INKS, LOCKUP_DRAWING, LOCKUP_VIEW_BOX, MARK_VIEW_BOX } from '@/lockup'
