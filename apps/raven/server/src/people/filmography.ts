import {
  type CreditJob,
  type FilmographyCredit,
  type FilmographyDepartment,
  type FilmographyEntry,
  type ItemSummary,
  isMatchItemType,
} from '@raven/core'
import { groupBy } from '@/groupBy'
import type { LocalCredit } from '@/metadata/metadataRepository'
import { yearOf } from '@/metadata/tmdbClient'
import type { FilmographyRow } from '@/people/peopleRepository'

/** Crew jobs that are no work on the title: a thank-you in the credits, a dedication. */
const IGNORED_JOBS = ['Thanks', 'In Memory Of'] as const

/** An appearance as themselves, by the role: "Self", "Himself (archive footage)", "Host". */
const SELF_ROLE =
  /^\s*(self|him\s*self|her\s*self|them\s*sel(f|ves)|host|co-host|guest host|presenter)\b/i

/** Talk and News, where everyone on screen is themselves. */
const SELF_GENRES = [10767, 10763] as const

/** The department a filmography tabs a local credit under. */
const LOCAL_DEPARTMENTS = {
  cast: 'acting',
  guest: 'acting',
  director: 'directing',
  writer: 'writing',
  creator: 'writing',
  producer: 'producing',
} as const satisfies Record<CreditJob, FilmographyDepartment>

/**
 * TMDB's department for a credit, folded to the filmography's. A producer is
 * one by the job, whatever department TMDB files it under.
 */
export const departmentOf = ({
  department,
  role,
}: {
  department: string
  role: string | null
}): FilmographyDepartment => {
  if (department === 'Acting') return 'acting'
  if (role?.includes('Producer') ?? false) return 'producing'
  if (department === 'Directing') return 'directing'
  if (department === 'Writing' || department === 'Creator' || role === 'Creator') return 'writing'
  return 'crew'
}

/** Whether an acting credit is as themselves: on a talk or news show, or by the role. */
export const isSelfAppearance = ({
  department,
  role,
  genreIds,
}: {
  department: string
  role: string | null
  genreIds: readonly number[]
}): boolean =>
  department === 'Acting' &&
  (SELF_GENRES.some((genre) => genreIds.includes(genre)) || SELF_ROLE.test(role ?? ''))

const isIgnored = ({ department, role }: FilmographyRow): boolean =>
  department !== 'Acting' && IGNORED_JOBS.some((job) => job === role)

const actingFirst = (credits: readonly FilmographyCredit[]): FilmographyCredit[] =>
  credits.toSorted((a, b) => Number(b.department === 'acting') - Number(a.department === 'acting'))

const byReleased = (a: FilmographyEntry, b: FilmographyEntry): number => {
  if (a.released === b.released) return 0
  if (a.released == null) return -1
  if (b.released == null) return 1
  return b.released.localeCompare(a.released)
}

/** Undated first, as what is still to come, then newest first, then by title. */
const inOrder = (a: FilmographyEntry, b: FilmographyEntry): number =>
  byReleased(a, b) || a.title.localeCompare(b.title)

/**
 * A person's filmography, one entry per title: TMDB's credits, less the
 * ignored jobs, and then the local credits on titles TMDB does not list.
 * An entry's `item` is set only when a library the viewer `sees` holds a
 * file of it, so a title that is only in a locked library, or has no file
 * at all, shows as not on raven.
 */
export const toEntries = ({
  rows,
  holding,
  sees,
  summaries,
  localCredits,
}: {
  rows: readonly FilmographyRow[]
  /** The libraries holding a file of each row's item. */
  holding: ReadonlyMap<number, readonly number[]>
  sees: (libraryId: number) => boolean
  summaries: ReadonlyMap<number, ItemSummary>
  /** The person's credits in raven, already narrowed to what the viewer sees. */
  localCredits: readonly LocalCredit[]
}): FilmographyEntry[] => {
  const kept = rows.filter((row) => !isIgnored(row))
  const listed = [
    ...groupBy({ items: kept, key: (row) => `${row.type}:${row.tmdbId}` }).values(),
  ].flatMap((group): FilmographyEntry[] => {
    const [first] = group
    if (!first) return []
    const stored = first.itemId == null ? null : (summaries.get(first.itemId) ?? null)
    const isShown = stored != null && (holding.get(stored.id) ?? []).some(sees)
    return [
      {
        type: first.type,
        tmdbId: first.tmdbId,
        title: first.title,
        year: yearOf(first.released),
        released: first.released,
        poster: first.poster,
        credits: actingFirst(
          group.map((row) => ({
            department: departmentOf(row),
            role: row.role,
            episodes: row.episodes,
            isSelf: isSelfAppearance(row),
          })),
        ),
        item: isShown ? stored : null,
      },
    ]
  })
  const listedItems = new Set(kept.flatMap((row) => row.itemId ?? []))
  const unlisted = localCredits.filter((credit) => !listedItems.has(credit.item.id))
  const local = [
    ...groupBy({ items: unlisted, key: (credit) => String(credit.item.id) }).values(),
  ].flatMap((credits): FilmographyEntry[] => {
    const [first] = credits
    if (!first || !isMatchItemType(first.item.type)) return []
    return [
      {
        type: first.item.type,
        tmdbId: first.tmdbId,
        title: first.item.title,
        year: first.item.year,
        // A summary has no date or TMDB poster; the page draws the item's own poster.
        released: null,
        poster: null,
        credits: actingFirst(
          credits.map((credit) => ({
            department: LOCAL_DEPARTMENTS[credit.job],
            role: credit.role,
            episodes: null,
            isSelf: false,
          })),
        ),
        item: first.item,
      },
    ]
  })
  return [...listed, ...local].toSorted(inOrder)
}
