import { MUSIC_ORDER_LABELS, MUSIC_SORT_LABELS, plural } from '@raven/core'

import { COMMON_COPY } from '@/lib/copy'

type FinishedEmptyProps = { name: string; percent: number }

type NoAlbumMatchesProps = { name: string; query: string }

type DolbyVisionOnlyEpisodesProps = { count: number; total: number }

export const LIBRARY_COPY = {
  noun: 'library',
  videos: 'videos',
  notMatchedCount: (count: string) => ` · ${count} not matched`,
  lock: 'Lock',
  lockTitle: 'Lock this library again: the PIN is asked for it the next time',
  sections: 'Sections',
  matched: 'Matched',
  show: 'show',
  shows: 'shows',
  gathering: (what: string) => `Gathering the ${what}`,
  saveFailed: (message: string) => `Could not save how this library is shown: ${message}`,
  changingView: 'Changing the view',
  inProgressEmpty: (name: string) =>
    `Nothing in progress in ${name}. A video left partway through waits here.`,
  inProgressUnsaved: (name: string) =>
    `${name} does not save where videos stop, so nothing waits here. Edit can turn that on.`,
  favouritesEmpty: (name: string) =>
    `No favourites in ${name} yet. Open a video's menu, from the button in its corner or a right click, and choose Favourite, or press the heart on a show's page.`,
  sagasEmpty: (name: string) =>
    `No sagas in ${name} yet. One shows here once two movies or more from the same TMDB collection are in the library.`,
  title: 'title',
  pointAt: (title: string) => `point these at the right ${title}`,
  fixShowMatch: 'Choose Fix match beside a show to point its folder at the right show.',
  fixFileMatch: (title: string) =>
    `Open a file's menu and choose Fix match to point it at the right ${title}.`,
  allMatched: (name: string) => `Every file in ${name} is matched.`,
  duplicatesEmpty: (name: string) => `No movie in ${name} has more than one file.`,
  dolbyVisionOnlyEmpty: (name: string) => `Nothing in ${name} is in Dolby Vision profile 5.`,
  dolbyVisionOnlyNote:
    'Dolby Vision profile 5 shows true colours only on a device with Dolby Vision, such as an Apple TV 4K or a Dolby Vision TV. A browser plays it purple and green.',
  dolbyVisionOnlyEpisodes: ({ count, total }: DolbyVisionOnlyEpisodesProps) =>
    `${count} of ${plural({ n: total, one: 'episode', many: 'episodes' })} in profile 5`,
  finishedEmpty: ({ name, percent }: FinishedEmptyProps) =>
    `Nothing finished in ${name} yet. A video counts once playback gets ${percent}% of the way through, or when you mark it watched.`,
  fullHistory: 'Full history',
  searchLibrary: (name: string) => `Search ${name}`,
  searchAlbums: 'Search albums and artists',
  tracksFailed: (message: string) => `Could not read the tracks: ${message}`,
  noAlbumMatches: ({ name, query }: NoAlbumMatchesProps) =>
    `No album in ${name} matches "${query}".`,
  noAlbums: (name: string) =>
    `No albums in ${name} yet. A scan files each audio file under its album as it reads its tags.`,
  noUnmatchedAlbums: (name: string) => `Every album in ${name} has a MusicBrainz match.`,
  smartMatchAlbums: 'AI smart match',
  smartMatchStarted: (count: number) =>
    `Smart match started on ${plural({ n: count, one: 'unmatched album', many: 'unmatched albums' })}. Each result shows here as it lands, and stays in Notifications.`,
  searchArtists: 'Search artists',
  noArtists: (name: string) => `No artists in ${name} yet.`,
  artists: 'Artists',
  sortLabels: MUSIC_SORT_LABELS,
  reverseOrder: 'Reverse sort order',
  directions: MUSIC_ORDER_LABELS,
  albumCount: (count: number) => plural({ n: count, one: 'album', many: 'albums' }),
  loadingArtists: 'Loading artists',
  sectionLabels: {
    all: COMMON_COPY.all,
    albums: COMMON_COPY.albums,
    artists: 'Artists',
    playlists: 'Playlists',
    unmatchedAlbums: 'Unmatched albums',
    inProgress: 'In progress',
    favourites: COMMON_COPY.favourites,
    sagas: 'Sagas',
    notMatched: COMMON_COPY.notMatched,
    duplicates: 'Duplicates',
    dolbyVisionOnly: 'Dolby Vision 5',
    finished: 'Recently finished',
  },
} as const
