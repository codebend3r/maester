import {
  ITEM_TYPES,
  type Library,
  type LibraryCounts,
  type LibraryKind,
  matchTypeFor,
  listsAlbums,
  libraryPath,
  libraryTabPath,
} from '@raven/core'
import type { IconName } from '@raven/ui'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'

/**
 * The tabs of a library's page, in order. Each but All is its own address
 * beneath the library's, `/libraries/:id/sagas`, so a tab can be linked to
 * and the back button steps between them.
 */
export const LIBRARY_SECTIONS = {
  all: 'all',
  albums: 'albums',
  artists: 'artists',
  playlists: 'playlists',
  unmatchedAlbums: 'unmatched-albums',
  inProgress: 'in-progress',
  favourites: 'favourites',
  sagas: 'sagas',
  notMatched: 'not-matched',
  duplicates: 'duplicates',
  dolbyVisionOnly: 'dolby-vision',
  finished: 'finished',
} as const

export type LibrarySection = (typeof LIBRARY_SECTIONS)[keyof typeof LIBRARY_SECTIONS]

const always = (): boolean => true

/** TMDB keeps collections of movies alone, and only a movie gathers several files on one card. */
const matchedToMovies = (kind: LibraryKind): boolean => matchTypeFor(kind) === ITEM_TYPES.movie

const matchedFiles = (kind: LibraryKind): boolean =>
  matchTypeFor(kind) != null && !listsAlbums(kind)

/** Every library but music lists its files or shows; music lists albums, with its artists on a tab of their own. */
const listsFiles = (kind: LibraryKind): boolean => !listsAlbums(kind)

/**
 * Every count a tab can show: those the library carries, and the account's
 * own from its counts.
 */
export type Tallies = Pick<Library, 'itemCount' | 'unmatchedCount'> & LibraryCounts

/** How many finished videos Recently finished lists; the History page has the rest. */
export const FINISHED_LIMIT = 48

/**
 * What each tab is called, the icon that tells it apart (all a narrow
 * screen shows of it), which types of library have it, the tally its count
 * reads, and the most it lists, past which the count reads as that many
 * and more. Sagas and Duplicates are only where files are matched to
 * movies, and Not matched for matched video libraries. Music libraries have
 * a separate tab for albums whose MusicBrainz match is still missing.
 */
export const SECTIONS = {
  all: {
    label: LIBRARY_COPY.sectionLabels.all,
    icon: 'grid',
    isFor: listsFiles,
    tally: 'itemCount',
    most: null,
    onlyWhenAny: false,
  },
  albums: {
    label: LIBRARY_COPY.sectionLabels.albums,
    icon: 'disc',
    isFor: listsAlbums,
    tally: null,
    most: null,
    onlyWhenAny: false,
  },
  artists: {
    label: LIBRARY_COPY.sectionLabels.artists,
    icon: 'music',
    isFor: listsAlbums,
    tally: null,
    most: null,
    onlyWhenAny: false,
  },
  // The account's own playlists, which span every music library it may see.
  playlists: {
    label: LIBRARY_COPY.sectionLabels.playlists,
    icon: 'list',
    isFor: listsAlbums,
    tally: null,
    most: null,
    onlyWhenAny: false,
  },
  'unmatched-albums': {
    label: LIBRARY_COPY.sectionLabels.unmatchedAlbums,
    icon: 'alert',
    isFor: listsAlbums,
    tally: null,
    most: null,
    onlyWhenAny: false,
  },
  'in-progress': {
    label: LIBRARY_COPY.sectionLabels.inProgress,
    icon: 'playback',
    isFor: always,
    tally: 'inProgress',
    most: null,
    onlyWhenAny: false,
  },
  favourites: {
    label: LIBRARY_COPY.sectionLabels.favourites,
    icon: 'heart',
    isFor: always,
    tally: 'favourites',
    most: null,
    onlyWhenAny: false,
  },
  sagas: {
    label: LIBRARY_COPY.sectionLabels.sagas,
    icon: 'covers',
    isFor: matchedToMovies,
    tally: 'sagas',
    most: null,
    onlyWhenAny: false,
  },
  'not-matched': {
    label: LIBRARY_COPY.sectionLabels.notMatched,
    icon: 'alert',
    isFor: matchedFiles,
    tally: 'unmatchedCount',
    most: null,
    onlyWhenAny: false,
  },
  duplicates: {
    label: LIBRARY_COPY.sectionLabels.duplicates,
    icon: 'copy',
    isFor: matchedToMovies,
    tally: 'duplicates',
    most: null,
    onlyWhenAny: false,
  },
  // What a browser plays purple and green; the tab is there only while the library holds some.
  'dolby-vision': {
    label: LIBRARY_COPY.sectionLabels.dolbyVisionOnly,
    icon: 'sun',
    isFor: listsFiles,
    tally: 'dolbyVisionOnly',
    most: null,
    onlyWhenAny: true,
  },
  finished: {
    label: LIBRARY_COPY.sectionLabels.finished,
    icon: 'check',
    isFor: always,
    tally: 'finished',
    most: FINISHED_LIMIT,
    onlyWhenAny: false,
  },
} as const satisfies Record<
  LibrarySection,
  {
    label: string
    icon: IconName
    isFor: (kind: LibraryKind) => boolean
    /** The count beside the tab; null for a tab that shows none. */
    tally: keyof Tallies | null
    most: number | null
    /** Whether the tab shows only once its tally is more than none. */
    onlyWhenAny: boolean
  }
>

const count = new Intl.NumberFormat()

type CountTextProps = {
  section: LibrarySection
  tallies: Partial<Tallies>
}

/** The count beside a tab, `48+` past the most it lists; null while its tally is on its way. */
export const countText = ({ section, tallies }: CountTextProps): string | null => {
  const { tally, most } = SECTIONS[section]
  const n = tally === null ? null : tallies[tally]
  if (n == null) return null
  return most != null && n > most ? `${count.format(most)}+` : count.format(n)
}

type HasSectionProps = {
  kind: LibraryKind
  section: LibrarySection
}

/** Whether a library of `kind` has the tab. */
export const hasSection = ({ kind, section }: HasSectionProps): boolean =>
  SECTIONS[section].isFor(kind)

export const sectionsFor = (kind: LibraryKind): LibrarySection[] =>
  Object.values(LIBRARY_SECTIONS).filter((section) => hasSection({ kind, section }))

type IsListedProps = { section: LibrarySection; tallies: Partial<Tallies> }

/** Whether a tab of the library shows beside the others: always, or once its tally holds any. */
export const isListed = ({ section, tallies }: IsListedProps): boolean => {
  const { onlyWhenAny, tally } = SECTIONS[section]
  if (!onlyWhenAny) return true
  return tally != null && (tallies[tally] ?? 0) > 0
}

type SectionPathProps = {
  libraryId: number
  section: LibrarySection
}

/** The tab a library opens on: its albums, or All. */
export const openingSection = (kind: LibraryKind): LibrarySection =>
  listsAlbums(kind) ? LIBRARY_SECTIONS.albums : LIBRARY_SECTIONS.all

/** Whether a tab is the one the library's own address opens: All, or a music library's Albums. */
const isOpening = (section: LibrarySection): boolean =>
  section === LIBRARY_SECTIONS.all || section === LIBRARY_SECTIONS.albums

/** A tab's address; the opening tab is the library's own. */
export const sectionPath = ({ libraryId, section }: SectionPathProps): string =>
  isOpening(section)
    ? libraryPath(libraryId)
    : libraryTabPath({ libraryId: libraryId, tab: section })

type SectionFromProps = { param: string | undefined; kind: LibraryKind }

/**
 * The tab a `:section` route param names: the library's opening tab when
 * there is none, and null for one that names no tab, the opening tabs
 * included, as those have no address of their own.
 */
export const sectionFrom = ({ param, kind }: SectionFromProps): LibrarySection | null => {
  if (param === undefined) return openingSection(kind)
  return (
    Object.values(LIBRARY_SECTIONS).find((section) => !isOpening(section) && section === param) ??
    null
  )
}
