import {
  ITEM_TYPES,
  type Library,
  type LibraryCounts,
  type LibraryKind,
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
  all: { label: 'All', icon: 'grid', isFor: always, tally: 'itemCount', most: null },
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
    tally: keyof Tallies
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
  const n = tallies[tally]
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

/** A tab's address; All is the library's own. */
export const sectionPath = ({ libraryId, section }: SectionPathProps): string =>
  section === LIBRARY_SECTIONS.all
    ? `/libraries/${libraryId}`
    : `/libraries/${libraryId}/${section}`

/**
 * The tab a `:section` route param names: All when there is none, and null
 * for one that names no tab, `all` included, as All has no address of its own.
 */
export const sectionFrom = (param: string | undefined): LibrarySection | null => {
  if (param === undefined) return LIBRARY_SECTIONS.all
  return (
    Object.values(LIBRARY_SECTIONS).find(
      (section) => section !== LIBRARY_SECTIONS.all && section === param,
    ) ?? null
  )
}
