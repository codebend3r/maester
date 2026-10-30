import {
  type FilmographyDepartment,
  type FilmographyEntry,
  type FilmographyTab,
  type SortColumn,
  ITEM_TYPES,
  itemPath,
  sortTitle,
} from '@raven/core'
import { memo, useState } from 'react'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { CardLink } from '@/components/CardLink/CardLink'
import { Bone } from '@/components/Skeleton/Skeleton'
import { SortHeader } from '@/components/SortHeader/SortHeader'
import { api } from '@/lib/api'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { useTableSort } from '@/lib/useTableSort'
import { PERSON_COPY } from '@/pages/PersonPage/copy'
import styles from '@/pages/PersonPage/FilmographyTable.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const DEPARTMENT_LABELS: Record<FilmographyDepartment, string> = PERSON_COPY.departments

/** Each distinct value once, in the order they first come. */
const distinct = (values: readonly string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) === index)

/** Their parts in a title, each once: "Neo · Producer". */
export const rolesOf = (entry: FilmographyEntry): string =>
  distinct(entry.credits.flatMap((credit) => (credit.role ? [credit.role] : []))).join(
    COMMON_COPY.separator,
  )

/** The kinds of work they did on a title, each once: "Acting · Producing". */
const departmentsOf = (entry: FilmographyEntry): string =>
  distinct(entry.credits.map((credit) => DEPARTMENT_LABELS[credit.department])).join(
    COMMON_COPY.separator,
  )

/**
 * The most episodes of a show any one of their parts covers, or null where
 * TMDB counts none; its 0 is no count either. The most rather than the sum,
 * as two parts in a show can share an episode.
 */
const episodesOf = (entry: FilmographyEntry): number | null =>
  entry.credits.reduce<number | null>(
    (most, credit) =>
      credit.episodes == null || credit.episodes === 0
        ? most
        : Math.max(most ?? credit.episodes, credit.episodes),
    null,
  )

/** The title's page on TMDB, for one raven does not hold. */
const tmdbUrl = (entry: FilmographyEntry): string =>
  `https://www.themoviedb.org/${entry.type === ITEM_TYPES.movie ? 'movie' : 'tv'}/${entry.tmdbId}`

/** A title with no date is still to come, so it sorts as the newest, as the server lists it. */
const UNDATED = '9999'

const COLUMN_KEYS = { year: 'year', title: 'title', onRaven: 'onRaven' } as const

type Column = (typeof COLUMN_KEYS)[keyof typeof COLUMN_KEYS]

const COLUMNS: Record<Column, SortColumn<FilmographyEntry>> = {
  [COLUMN_KEYS.year]: { value: (entry) => entry.released ?? UNDATED, first: 'desc' },
  [COLUMN_KEYS.title]: { value: (entry) => sortTitle(entry.title), first: 'asc' },
  [COLUMN_KEYS.onRaven]: { value: (entry) => (entry.item ? 1 : 0), first: 'desc' },
}

/** Raven's own poster where it holds the title, else TMDB's through raven's image cache. */
const posterOf = (entry: FilmographyEntry): ReturnType<typeof posterSources> => {
  const own = entry.item ? posterSources({ item: entry.item, sizes: POSTER_SIZES.list }) : null
  if (own) return own
  return entry.poster == null
    ? null
    : { ...api.tmdbPosterSources(entry.poster), sizes: POSTER_SIZES.list }
}

/** Whether a small poster shows its picture or, with none or one that failed, the title's initial. */
const SMALL_POSTER_KEYS = { picture: 'picture', initial: 'initial' } as const

type SmallPictureProps = {
  poster: NonNullable<ReturnType<typeof posterOf>>
  onError: () => void
}

const SmallPicture = ({ poster, onError }: SmallPictureProps) => (
  <img
    className={styles.image}
    {...poster}
    alt=""
    loading="lazy"
    decoding="async"
    onError={onError}
  />
)

type SmallInitialProps = { title: string }

const SmallInitial = ({ title }: SmallInitialProps) => (
  <span className={styles.placeholder}>{title.slice(0, 1)}</span>
)

type SmallPosterViewProps = {
  [SMALL_POSTER_KEYS.picture]: SmallPictureProps
  [SMALL_POSTER_KEYS.initial]: SmallInitialProps
}

const SMALL_POSTER_VIEWS = {
  [SMALL_POSTER_KEYS.picture]: SmallPicture,
  [SMALL_POSTER_KEYS.initial]: SmallInitial,
} as const satisfies ViewsOf<SmallPosterViewProps>

type SmallPosterViewOfProps = {
  entry: FilmographyEntry
  hasFailed: boolean
  onError: () => void
}

const smallPosterViewOf = ({
  entry,
  hasFailed,
  onError,
}: SmallPosterViewOfProps): ViewOf<SmallPosterViewProps> => {
  const poster = posterOf(entry)
  if (poster && !hasFailed) return { key: SMALL_POSTER_KEYS.picture, props: { poster, onError } }
  return { key: SMALL_POSTER_KEYS.initial, props: { title: entry.title } }
}

type SmallPosterProps = { entry: FilmographyEntry }

/** A title's small poster, or its initial; the title beside it says what it is, so it is hidden. */
const SmallPoster = ({ entry }: SmallPosterProps) => {
  const [hasFailed, setHasFailed] = useState(false)
  return (
    <span className={styles.frame} aria-hidden="true">
      <KeyedView<SmallPosterViewProps>
        views={SMALL_POSTER_VIEWS}
        view={smallPosterViewOf({ entry, hasFailed, onError: () => setHasFailed(true) })}
      />
    </span>
  )
}

/** Whether raven holds a title, so it links to raven's page or to TMDB's. */
const HOLDING_KEYS = { held: 'held', missing: 'missing' } as const

type HeldTitleProps = { entry: FilmographyEntry; page: NonNullable<ReturnType<typeof itemPath>> }

const HeldTitle = ({ entry, page }: HeldTitleProps) => (
  <CardLink to={page} className={styles.title}>
    {entry.title}
  </CardLink>
)

type MissingTitleProps = { entry: FilmographyEntry }

const MissingTitle = ({ entry }: MissingTitleProps) => (
  <a href={tmdbUrl(entry)} target="_blank" rel="noreferrer" className={styles.title}>
    {entry.title}
    <span className="visually-hidden">{PERSON_COPY.onTmdb}</span>
  </a>
)

type HeldMarkProps = HeldTitleProps

const HeldMark = ({ entry, page }: HeldMarkProps) => (
  <CardLink to={page} className={styles.onRaven} aria-label={PERSON_COPY.titleOnRaven(entry.title)}>
    {PERSON_COPY.onRaven}
  </CardLink>
)

const MissingMark = () => <span className={styles.notOnRaven}>{PERSON_COPY.notOnRaven}</span>

type HoldingViewProps = {
  [HOLDING_KEYS.held]: HeldTitleProps
  [HOLDING_KEYS.missing]: MissingTitleProps
}

const TITLE_VIEWS = {
  [HOLDING_KEYS.held]: HeldTitle,
  [HOLDING_KEYS.missing]: MissingTitle,
} as const satisfies ViewsOf<HoldingViewProps>

const MARK_VIEWS = {
  [HOLDING_KEYS.held]: HeldMark,
  [HOLDING_KEYS.missing]: MissingMark,
} as const satisfies ViewsOf<HoldingViewProps>

type HoldingViewOfProps = { entry: FilmographyEntry; page: ReturnType<typeof itemPath> }

const holdingViewOf = ({ entry, page }: HoldingViewOfProps): ViewOf<HoldingViewProps> => {
  if (page) return { key: HOLDING_KEYS.held, props: { entry, page } }
  return { key: HOLDING_KEYS.missing, props: { entry } }
}

const KIND_LABELS = {
  [ITEM_TYPES.movie]: PERSON_COPY.movie,
  [ITEM_TYPES.show]: PERSON_COPY.tv,
} as const satisfies Record<FilmographyEntry['type'], string>

type FilmographyRowProps = {
  entry: FilmographyEntry
  hasDepartment: boolean
}

/** One title: its year, poster, name and kind, their parts in it, and whether raven holds it. */
const FilmographyRow = ({ entry, hasDepartment }: FilmographyRowProps) => {
  const page = entry.item ? itemPath(entry.item) : null
  const roles = rolesOf(entry)
  const episodes = episodesOf(entry)
  const holding = holdingViewOf({ entry, page })
  return (
    <tr>
      <td className={entry.year == null ? `${styles.number} ${styles.undated}` : styles.number}>
        {entry.year ?? PERSON_COPY.undated}
      </td>
      <th scope="row" className={styles.titleHeader}>
        <div className={styles.titleCell}>
          <SmallPoster entry={entry} />
          <span className={styles.named}>
            <KeyedView<HoldingViewProps> views={TITLE_VIEWS} view={holding} />{' '}
            <span className={styles.kind}>{KIND_LABELS[entry.type]}</span>
          </span>
        </div>
      </th>
      <td className={styles.spare}>
        {roles && <span className={styles.roles}>{roles}</span>}
        {episodes != null && (
          <span className={styles.episodes}>{COMMON_COPY.episodes(episodes)}</span>
        )}
      </td>
      {hasDepartment && (
        <td className={`${styles.department} ${styles.roomy}`}>{departmentsOf(entry)}</td>
      )}
      <td>
        <KeyedView<HoldingViewProps> views={MARK_VIEWS} view={holding} />
      </td>
    </tr>
  )
}

type FilmographyTableProps = {
  entries: readonly FilmographyEntry[]
  tab: FilmographyTab
  isHidden: boolean
}

/**
 * The titles a tab lists, as rows of facts in the server's order until a
 * column is sorted: Year, Title and On raven sort. Department shows on All
 * alone, the one tab that mixes them. A search that matches nothing hides
 * the table rather than dropping it, so its sort is there when the rows
 * come back. Memoized, so typing in the search draws the rows again only
 * once the query it asks for changes.
 */
export const FilmographyTable = memo(function FilmographyTable({
  entries,
  tab,
  isHidden,
}: FilmographyTableProps) {
  const { sorted, toggle, ariaSort } = useTableSort({ rows: entries, columns: COLUMNS })
  const hasDepartment = tab === 'all'
  type HeaderProps = {
    column: Column
    label: string
    className?: string
  }

  const header = ({ column, label, className }: HeaderProps) => (
    <SortHeader sort={ariaSort(column)} onToggle={() => toggle(column)} className={className}>
      {label}
    </SortHeader>
  )
  return (
    <div className={styles.room} hidden={isHidden}>
      <table className={styles.table} aria-label={PERSON_COPY.filmography}>
        <thead>
          <tr>
            {header({
              column: COLUMN_KEYS.year,
              label: COMMON_COPY.year,
              className: styles.number,
            })}
            {header({ column: COLUMN_KEYS.title, label: COMMON_COPY.title })}
            <th scope="col" className={styles.spare}>
              {PERSON_COPY.role}
            </th>
            {hasDepartment && (
              <th scope="col" className={styles.roomy}>
                {PERSON_COPY.department}
              </th>
            )}
            {header({ column: COLUMN_KEYS.onRaven, label: PERSON_COPY.onRaven })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => (
            <FilmographyRow
              key={`${entry.type}-${entry.tmdbId}`}
              entry={entry}
              hasDepartment={hasDepartment}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
})

/** Rows of a filmography on their way: a year, a poster, a title and a mark apiece. */
export const FilmographyBones = () => (
  <ul className={styles.bones}>
    {Array.from({ length: 8 }, (_, index) => (
      <li key={index} className={styles.boneRow}>
        <Bone shape="small" />
        <span className={styles.boneFrame}>
          <Bone shape="fill" />
        </span>
        <Bone shape="text" width="most" />
        <Bone shape="small" />
      </li>
    ))}
  </ul>
)
