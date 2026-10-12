import { type LibraryKind, matchTypeFor } from '@raven/core'

/**
 * The tabs of a library's page, in order. Each but All is its own address
 * beneath the library's, `/libraries/:id/sagas`, so a tab can be linked to
 * and the back button steps between them.
 */
export const LIBRARY_SECTIONS = [
  'all',
  'in-progress',
  'favourites',
  'not-matched',
  'finished',
] as const

export type LibrarySection = (typeof LIBRARY_SECTIONS)[number]

const always = (): boolean => true


const matched = (kind: LibraryKind): boolean => matchTypeFor(kind) != null

/**
 * What each tab is called, and which types of library have it: Sagas and
 * Duplicates only where files are matched to movies, and Not matched
 * wherever files are matched at all.
 */
export const SECTIONS = {
  all: { label: 'All', isFor: always },
  'in-progress': { label: 'In progress', isFor: always },
  favourites: { label: 'Favourites', isFor: always },
  'not-matched': { label: 'Not matched', isFor: matched },
  finished: { label: 'Recently finished', isFor: always },
} as const satisfies Record<
  LibrarySection,
  { label: string; isFor: (kind: LibraryKind) => boolean }
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
  LIBRARY_SECTIONS.filter((section) => hasSection({ kind, section }))

/** A tab's address; All is the library's own. */
export const sectionPath = ({
  libraryId,
  section,
}: {
  libraryId: number
  section: LibrarySection
}): string => (section === 'all' ? `/libraries/${libraryId}` : `/libraries/${libraryId}/${section}`)

/**
 * The tab a `:section` route param names: All when there is none, and null
 * for one that names no tab, `all` included, as All has no address of its own.
 */
export const sectionFrom = (param: string | undefined): LibrarySection | null => {
  if (param === undefined) return 'all'
  return LIBRARY_SECTIONS.find((section) => section !== 'all' && section === param) ?? null
}
