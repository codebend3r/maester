import {
  ITEM_TYPES,
  LIBRARY_LISTINGS,
  type Library,
  type LibraryCounts,
  type LibraryKind,
  listingFor,
  matchTypeFor,
} from '@raven/core'
import type { IconName } from '@raven/ui'

/**
 * The tabs of a library's page, in order. Each but All is its own address
 * beneath the library's, `/libraries/:id/sagas`, so a tab can be linked to
 * and the back button steps between them.
 */
export const LIBRARY_SECTIONS = {
  all: 'all',
  albums: 'albums',
  artists: 'artists',
  inProgress: 'in-progress',
  favourites: 'favourites',
  sagas: 'sagas',
  notMatched: 'not-matched',
  duplicates: 'duplicates',
  finished: 'finished',
} as const

export type LibrarySection = (typeof LIBRARY_SECTIONS)[keyof typeof LIBRARY_SECTIONS]

const always = (): boolean => true

/** TMDB keeps collections of movies alone, and only a movie gathers several files on one card. */
const matchedToMovies = (kind: LibraryKind): boolean => matchTypeFor(kind) === ITEM_TYPES.movie

const matched = (kind: LibraryKind): boolean => matchTypeFor(kind) != null

/** A music library lists albums, and has its artists on a tab of their own; every other lists its files or shows. */
const listsAlbums = (kind: LibraryKind): boolean => listingFor(kind) === LIBRARY_LISTINGS.albums

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
 * movies, and Not matched wherever files are matched at all.
 */
export const SECTIONS = {
  all: { label: 'All', icon: 'grid', isFor: listsFiles, tally: 'itemCount', most: null },
  albums: { label: 'Albums', icon: 'disc', isFor: listsAlbums, tally: null, most: null },
  artists: { label: 'Artists', icon: 'music', isFor: listsAlbums, tally: null, most: null },
  'in-progress': {
    label: 'In progress',
    icon: 'playback',
    isFor: always,
    tally: 'inProgress',
    most: null,
  },
  favourites: {
    label: 'Favourites',
    icon: 'heart',
    isFor: always,
    tally: 'favourites',
    most: null,
  },
  sagas: { label: 'Sagas', icon: 'covers', isFor: matchedToMovies, tally: 'sagas', most: null },
  'not-matched': {
    label: 'Not matched',
    icon: 'alert',
    isFor: matched,
    tally: 'unmatchedCount',
    most: null,
  },
  duplicates: {
    label: 'Duplicates',
    icon: 'copy',
    isFor: matchedToMovies,
    tally: 'duplicates',
    most: null,
  },
  finished: {
    label: 'Recently finished',
    icon: 'check',
    isFor: always,
    tally: 'finished',
    most: FINISHED_LIMIT,
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
  isOpening(section) ? `/libraries/${libraryId}` : `/libraries/${libraryId}/${section}`

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
