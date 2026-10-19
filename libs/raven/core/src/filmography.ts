import { type FilmographyEntry, type FilmographyDepartment } from '@/contract'
import { type Infer, oneOf } from '@/schema'

/** The tabs a filmography table offers, in order; `crew` credits show on `all` only. */
export const FILMOGRAPHY_TABS = ['all', 'acting', 'directing', 'writing', 'producing'] as const

export const isFilmographyTab = oneOf(FILMOGRAPHY_TABS)

export type FilmographyTab = Infer<typeof isFilmographyTab>

const isOnTab = ({
  department,
  tab,
}: {
  department: FilmographyDepartment
  tab: FilmographyTab
}): boolean => tab === 'all' || department === tab

/**
 * The entries a tab lists, in their order, each with only the credits that
 * tab shows; an entry left with none is dropped. Credits as themselves go
 * unless `isSelfShown`.
 */
export const entriesOn = ({
  entries,
  tab,
  isSelfShown,
}: {
  entries: readonly FilmographyEntry[]
  tab: FilmographyTab
  isSelfShown: boolean
}): FilmographyEntry[] =>
  entries.flatMap((entry) => {
    const credits = entry.credits.filter(
      (credit) =>
        (isSelfShown || !credit.isSelf) && isOnTab({ department: credit.department, tab }),
    )
    return credits.length > 0 ? [{ ...entry, credits }] : []
  })

/** How many entries each tab lists under the same toggle. */
export const tabCounts = ({
  entries,
  isSelfShown,
}: {
  entries: readonly FilmographyEntry[]
  isSelfShown: boolean
}): Record<FilmographyTab, number> => ({
  all: entriesOn({ entries, tab: 'all', isSelfShown }).length,
  acting: entriesOn({ entries, tab: 'acting', isSelfShown }).length,
  directing: entriesOn({ entries, tab: 'directing', isSelfShown }).length,
  writing: entriesOn({ entries, tab: 'writing', isSelfShown }).length,
  producing: entriesOn({ entries, tab: 'producing', isSelfShown }).length,
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

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const partsOf = (date: string | null): { year: number; month: number; day: number } | null => {
  const match = date == null ? null : DATE.exec(date)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/**
 * Whole years from `birthday` to `on`, both `YYYY-MM-DD`; null when either is
 * missing or malformed, or `on` comes before `birthday`. Read from the
 * strings, not a `Date`, so no time zone can move the day. A Feb 29 birthday
 * comes on Mar 1 in a year without one.
 */
export const ageOn = ({
  birthday,
  on,
}: {
  birthday: string | null
  on: string | null
}): number | null => {
  const born = partsOf(birthday)
  const now = partsOf(on)
  if (!born || !now) return null
  const hasHadBirthday = now.month > born.month || (now.month === born.month && now.day >= born.day)
  const age = now.year - born.year - (hasHadBirthday ? 0 : 1)
  return age < 0 ? null : age
}
