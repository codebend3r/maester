import type { DownloadView } from '@raven/core'
import { DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { DOWNLOADS_SHOWS, type DownloadsShow } from '@/stores/downloadsShow'

type VisibleDownloadsOfProps = {
  downloads: readonly DownloadView[]
  /** Whether the PIN has been entered: the server's own word, never a guess. */
  isUnlocked: boolean
}

/**
 * The downloads a viewer may see now: every one, less those of a private library while the PIN
 * has not been entered. What is hidden stays on disk; a download whose library is not known yet
 * is shown.
 */
export const visibleDownloadsOf = ({
  downloads,
  isUnlocked,
}: VisibleDownloadsOfProps): DownloadView[] =>
  downloads.filter((view) => isUnlocked || !(view.library?.isPrivate ?? false))

/** Whether any download came from a private library, so the page has a lock to ask about. */
export const hasPrivateDownloads = (downloads: readonly DownloadView[]): boolean =>
  downloads.some((view) => !!view.library?.isPrivate)

/** A run of downloads under one heading; `name` is null when they need none. */
export type DownloadsSection = { key: string; name: string | null; downloads: DownloadView[] }

/** What keys a section: the one run of everything, the downloads of no known library, or a library by id. */
const SECTION_KEYS = {
  everything: 'everything',
  other: 'other',
  libraryPrefix: 'library:',
} as const

const keyOf = ({ library }: DownloadView): string =>
  library === null ? SECTION_KEYS.other : `${SECTION_KEYS.libraryPrefix}${library.id}`

/** The downloads under their libraries, by name, those with no known library last under "Other". */
const byLibrary = (downloads: readonly DownloadView[]): DownloadsSection[] => {
  const sections = [...new Set(downloads.map(keyOf))].flatMap((key): DownloadsSection[] => {
    const held = downloads.filter((view) => keyOf(view) === key)
    const [first] = held
    if (first === undefined) return []
    return [{ key, name: first.library?.name ?? DOWNLOADS_PAGE_COPY.otherLibrary, downloads: held }]
  })
  const named = sections
    .filter(({ key }) => key !== SECTION_KEYS.other)
    .toSorted((left, right) => (left.name ?? '').localeCompare(right.name ?? ''))
  return [...named, ...sections.filter(({ key }) => key === SECTION_KEYS.other)]
}

type SectionsOf = (downloads: readonly DownloadView[]) => DownloadsSection[]

const SECTIONS = {
  [DOWNLOADS_SHOWS.everything]: (downloads) =>
    downloads.length === 0
      ? []
      : [{ key: SECTION_KEYS.everything, name: null, downloads: [...downloads] }],
  [DOWNLOADS_SHOWS.byLibrary]: byLibrary,
} as const satisfies Record<DownloadsShow, SectionsOf>

type SectionsOfProps = { downloads: readonly DownloadView[]; show: DownloadsShow }

/**
 * The downloads as the Show choice lays them out: all in one unheaded run, or a section a
 * library, each keeping the order the downloads came in.
 */
export const sectionsOf = ({ downloads, show }: SectionsOfProps): DownloadsSection[] =>
  SECTIONS[show](downloads)
