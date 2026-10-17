import { ITEM_TYPES, type Library, type LibraryKind, matchTypeFor } from '@raven/core'

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

/** What a tab's count reads from: the counts the library itself carries. */
type Counted = Pick<Library, 'itemCount' | 'unmatchedCount'>

/** A tab whose count would take its own listing to read, so it shows none. */
const uncounted = (): number | null => null

/**
 * What each tab is called, which types of library have it, and the count
 * beside it. Sagas and Duplicates are only where files are matched to
 * movies, and Not matched wherever files are matched at all. Only All and
 * Not matched are counted, from the library's own counts, Not matched while
 * it holds any; every other count would take that tab's listing to read.
 */
export const SECTIONS = {
  all: { label: 'All', isFor: always, count: (library: Counted) => library.itemCount },
  'in-progress': { label: 'In progress', isFor: always, count: uncounted },
  favourites: { label: 'Favourites', isFor: always, count: uncounted },
  sagas: { label: 'Sagas', isFor: matchedToMovies, count: uncounted },
  'not-matched': {
    label: 'Not matched',
    isFor: matched,
    count: (library: Counted) => (library.unmatchedCount > 0 ? library.unmatchedCount : null),
  },
  duplicates: { label: 'Duplicates', isFor: matchedToMovies, count: uncounted },
  finished: { label: 'Recently finished', isFor: always, count: uncounted },
} as const satisfies Record<
  LibrarySection,
  {
    label: string
    isFor: (kind: LibraryKind) => boolean
    count: (library: Counted) => number | null
  }
>

/** Whether a library of `kind` has the tab. */
export const hasSection = ({
  kind,
  section,
}: {
  kind: LibraryKind
  section: LibrarySection
}): boolean => SECTIONS[section].isFor(kind)

export const sectionsFor = (kind: LibraryKind): LibrarySection[] =>
  Object.values(LIBRARY_SECTIONS).filter((section) => hasSection({ kind, section }))

/** A tab's address; All is the library's own. */
export const sectionPath = ({
  libraryId,
  section,
}: {
  libraryId: number
  section: LibrarySection
}): string =>
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
