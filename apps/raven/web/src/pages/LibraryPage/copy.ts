import { MUSIC_SORTS, type MusicSort } from '@raven/core'

import { COMMON_COPY } from '@/lib/copy'

const SORT_LABELS = {
  [MUSIC_SORTS.title]: COMMON_COPY.title,
  [MUSIC_SORTS.artist]: 'Artist',
  [MUSIC_SORTS.year]: COMMON_COPY.year,
  [MUSIC_SORTS.added]: 'Recently added',
} as const satisfies Record<MusicSort, string>

type FinishedEmptyProps = { name: string; percent: number }

type NoAlbumMatchesProps = { name: string; query: string }

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
    `No favourites in ${name} yet. Open a video's menu, from the button in its corner or a right click, and choose Favourite.`,
  sagasEmpty: (name: string) =>
    `No sagas in ${name} yet. One shows here once two movies or more from the same TMDB collection are in the library.`,
  title: 'title',
  pointAt: (title: string) => `point these at the right ${title}`,
  fixShowMatch: 'Choose Fix match beside a show to point its folder at the right show.',
  fixFileMatch: (title: string) =>
    `Open a file's menu and choose Fix match to point it at the right ${title}.`,
  allMatched: (name: string) => `Every file in ${name} is matched.`,
  duplicatesEmpty: (name: string) => `No movie in ${name} has more than one file.`,
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
  searchArtists: 'Search artists',
  noArtists: (name: string) => `No artists in ${name} yet.`,
  artists: 'Artists',
  sortLabels: SORT_LABELS,
  sectionLabels: {
    all: COMMON_COPY.all,
    albums: COMMON_COPY.albums,
    artists: 'Artists',
    playlists: 'Playlists',
    inProgress: 'In progress',
    favourites: COMMON_COPY.favourites,
    sagas: 'Sagas',
    notMatched: COMMON_COPY.notMatched,
    duplicates: 'Duplicates',
    finished: 'Recently finished',
  },
} as const
