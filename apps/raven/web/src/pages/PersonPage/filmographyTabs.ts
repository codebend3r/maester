import { type FilmographyEntry, type FilmographyDepartment, type Infer, oneOf } from '@raven/core'

/** The tabs a filmography table offers, in order; `crew` credits show on `all` only. */
export const FILMOGRAPHY_TAB_NAMES = {
  all: 'all',
  acting: 'acting',
  directing: 'directing',
  writing: 'writing',
  producing: 'producing',
} as const

export const FILMOGRAPHY_TABS = [
  FILMOGRAPHY_TAB_NAMES.all,
  FILMOGRAPHY_TAB_NAMES.acting,
  FILMOGRAPHY_TAB_NAMES.directing,
  FILMOGRAPHY_TAB_NAMES.writing,
  FILMOGRAPHY_TAB_NAMES.producing,
] as const

export const isFilmographyTab = oneOf(FILMOGRAPHY_TABS)

export type FilmographyTab = Infer<typeof isFilmographyTab>

type IsOnTabProps = {
  department: FilmographyDepartment
  tab: FilmographyTab
}

const isOnTab = ({ department, tab }: IsOnTabProps): boolean =>
  tab === FILMOGRAPHY_TAB_NAMES.all || department === tab

type EntriesOnProps = {
  entries: readonly FilmographyEntry[]
  tab: FilmographyTab
  isSelfShown: boolean
}

/**
 * The entries a tab lists, in their order, each with only the credits that
 * tab shows; an entry left with none is dropped. Credits as themselves go
 * unless `isSelfShown`.
 */
export const entriesOn = ({ entries, tab, isSelfShown }: EntriesOnProps): FilmographyEntry[] =>
  entries.flatMap((entry) => {
    const credits = entry.credits.filter(
      (credit) =>
        (isSelfShown || !credit.isSelf) && isOnTab({ department: credit.department, tab }),
    )
    return credits.length > 0 ? [{ ...entry, credits }] : []
  })

type TabCountsProps = {
  entries: readonly FilmographyEntry[]
  isSelfShown: boolean
}

/** How many entries each tab lists under the same toggle. */
export const tabCounts = ({
  entries,
  isSelfShown,
}: TabCountsProps): Record<FilmographyTab, number> => ({
  all: entriesOn({ entries, tab: FILMOGRAPHY_TAB_NAMES.all, isSelfShown }).length,
  acting: entriesOn({ entries, tab: FILMOGRAPHY_TAB_NAMES.acting, isSelfShown }).length,
  directing: entriesOn({ entries, tab: FILMOGRAPHY_TAB_NAMES.directing, isSelfShown }).length,
  writing: entriesOn({ entries, tab: FILMOGRAPHY_TAB_NAMES.writing, isSelfShown }).length,
  producing: entriesOn({ entries, tab: FILMOGRAPHY_TAB_NAMES.producing, isSelfShown }).length,
})

/** The entries whose every credit is as themselves: what the toggle hides. */
export const selfCount = (entries: readonly FilmographyEntry[]): number =>
  entries.filter((entry) => entry.credits.every((credit) => credit.isSelf)).length

/**
 * Whether any credit is as themselves, and so whether the page offers the
 * toggle: one beside other work on a title hides too, though its entry stays.
 */
export const hasSelfCredits = (entries: readonly FilmographyEntry[]): boolean =>
  entries.some((entry) => entry.credits.some((credit) => credit.isSelf))
