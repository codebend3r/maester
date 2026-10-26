import {
  type FilmographyDepartment,
  type FilmographyEntry,
  type FilmographyTab,
  type SortColumn,
  itemPath,
  plural,
  sortTitle,
} from '@raven/core'
import { memo, useState } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { Bone } from '@/components/Skeleton/Skeleton'
import { SortHeader } from '@/components/SortHeader/SortHeader'
import { api } from '@/lib/api'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { useTableSort } from '@/lib/useTableSort'
import styles from '@/pages/PersonPage/FilmographyTable.module.scss'

const DEPARTMENT_LABELS: Record<FilmographyDepartment, string> = {
  acting: 'Acting',
  directing: 'Directing',
  writing: 'Writing',
  producing: 'Producing',
  crew: 'Crew',
}

/** Each distinct value once, in the order they first come. */
const distinct = (values: readonly string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) === index)

/** Their parts in a title, each once: "Neo · Producer". */
export const rolesOf = (entry: FilmographyEntry): string =>
  distinct(entry.credits.flatMap((credit) => (credit.role ? [credit.role] : []))).join(' · ')

/** The kinds of work they did on a title, each once: "Acting · Producing". */
const departmentsOf = (entry: FilmographyEntry): string =>
  distinct(entry.credits.map((credit) => DEPARTMENT_LABELS[credit.department])).join(' · ')

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
  `https://www.themoviedb.org/${entry.type === 'movie' ? 'movie' : 'tv'}/${entry.tmdbId}`

/** A title with no date is still to come, so it sorts as the newest, as the server lists it. */
const UNDATED = '9999'

type Column = 'year' | 'title' | 'onRaven'

const COLUMNS: Record<Column, SortColumn<FilmographyEntry>> = {
  year: { value: (entry) => entry.released ?? UNDATED, first: 'desc' },
  title: { value: (entry) => sortTitle(entry.title), first: 'asc' },
  onRaven: { value: (entry) => (entry.item ? 1 : 0), first: 'desc' },
}

/** Raven's own poster where it holds the title, else TMDB's through raven's image cache. */
const posterOf = (entry: FilmographyEntry): ReturnType<typeof posterSources> => {
  const own = entry.item ? posterSources({ item: entry.item, sizes: POSTER_SIZES.list }) : null
  if (own) return own
  return entry.poster == null
    ? null
    : { ...api.tmdbPosterSources(entry.poster), sizes: POSTER_SIZES.list }
}

type SmallPosterProps = { entry: FilmographyEntry }

/** A title's small poster, or its initial; the title beside it says what it is, so it is hidden. */
const SmallPoster = ({ entry }: SmallPosterProps) => {
  const poster = posterOf(entry)
  const [hasFailed, setHasFailed] = useState(false)
  return (
    <span className={styles.frame} aria-hidden="true">
      {poster && !hasFailed ? (
        <img
          className={styles.image}
          {...poster}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setHasFailed(true)}
        />
      ) : (
        <span className={styles.placeholder}>{entry.title.slice(0, 1)}</span>
      )}
    </span>
  )
}

type FilmographyRowProps = {
  entry: FilmographyEntry
  hasDepartment: boolean
}

/** One title: its year, poster, name and kind, their parts in it, and whether raven holds it. */
const FilmographyRow = ({ entry, hasDepartment }: FilmographyRowProps) => {
  const page = entry.item ? itemPath(entry.item) : null
  const roles = rolesOf(entry)
  const episodes = episodesOf(entry)
  return (
    <tr>
      <td className={entry.year == null ? `${styles.number} ${styles.undated}` : styles.number}>
        {entry.year ?? 'TBA'}
      </td>
      <th scope="row" className={styles.titleHeader}>
        <div className={styles.titleCell}>
          <SmallPoster entry={entry} />
          <span className={styles.named}>
            {page ? (
              <CardLink to={page} className={styles.title}>
                {entry.title}
              </CardLink>
            ) : (
              <a href={tmdbUrl(entry)} target="_blank" rel="noreferrer" className={styles.title}>
                {entry.title}
                <span className="visually-hidden"> on TMDB</span>
              </a>
            )}{' '}
            <span className={styles.kind}>{entry.type === 'movie' ? 'Movie' : 'TV'}</span>
          </span>
        </div>
      </th>
      <td className={styles.spare}>
        {roles && <span className={styles.roles}>{roles}</span>}
        {episodes != null && (
          <span className={styles.episodes}>
            {plural({ n: episodes, one: 'episode', many: 'episodes' })}
          </span>
        )}
      </td>
      {hasDepartment && (
        <td className={`${styles.department} ${styles.roomy}`}>{departmentsOf(entry)}</td>
      )}
      <td>
        {page ? (
          <CardLink to={page} className={styles.onRaven} aria-label={`${entry.title} on raven`}>
            On raven
          </CardLink>
        ) : (
          <span className={styles.notOnRaven}>Not on raven</span>
        )}
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
      <table className={styles.table} aria-label="Filmography">
        <thead>
          <tr>
            {header({ column: 'year', label: 'Year', className: styles.number })}
            {header({ column: 'title', label: 'Title' })}
            <th scope="col" className={styles.spare}>
              Role
            </th>
            {hasDepartment && (
              <th scope="col" className={styles.roomy}>
                Department
              </th>
            )}
            {header({ column: 'onRaven', label: 'On raven' })}
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
