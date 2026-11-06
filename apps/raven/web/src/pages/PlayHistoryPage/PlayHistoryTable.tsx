import { type AlbumRun, type PlayHistoryEntry, historyGroups, reachOf } from '@raven/core'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { PartLink, PlayedFrom } from '@/pages/PlayHistoryPage/PlayedCells'
import { playedLinks } from '@/pages/PlayHistoryPage/playedLinks'
import { PLAY_HISTORY_COPY } from '@/pages/PlayHistoryPage/copy'
import styles from '@/pages/PlayHistoryPage/PlayHistoryPage.module.scss'

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** How a table names an account: by its email when the owner's list has it. */
export type AccountName = (accountId: string) => string

const COLUMNS = {
  when: 'when',
  title: 'title',
  from: 'from',
  library: 'library',
  reach: 'reach',
  account: 'account',
} as const

type Column = (typeof COLUMNS)[keyof typeof COLUMNS]

const OWN_COLUMNS: readonly Column[] = [
  COLUMNS.when,
  COLUMNS.title,
  COLUMNS.from,
  COLUMNS.library,
  COLUMNS.reach,
]

/** The columns that fold away as the table narrows, so their headers fold with them. */
const HEAD_CLASSES: Partial<Record<Column, string>> = {
  [COLUMNS.from]: styles.from,
  [COLUMNS.library]: styles.library,
}

type EntryLineProps = { entry: PlayHistoryEntry; nameOf: AccountName | null }

const EntryLine = ({ entry, nameOf }: EntryLineProps) => {
  const music = useMusicLinks()
  const links = playedLinks({ entry, music })
  return (
    <tr>
      <td className={styles.when}>
        <time dateTime={entry.startedAt}>{when.format(new Date(entry.startedAt))}</time>
      </td>
      <th scope="row" className={styles.title}>
        <PartLink part={links.title} />
      </th>
      <td className={styles.from}>
        <PlayedFrom groups={links.from} />
      </td>
      <td className={styles.library}>{entry.libraryName}</td>
      <td className={styles.reach}>{PLAY_HISTORY_COPY.reach(reachOf(entry))}</td>
      {nameOf && <td className={styles.account}>{nameOf(entry.accountId)}</td>}
    </tr>
  )
}

type AlbumRunRowProps = { run: AlbumRun; span: number }

const AlbumRunRow = ({ run, span }: AlbumRunRowProps) => (
  <tr className={styles.run}>
    <th scope="rowgroup" colSpan={span}>
      {PLAY_HISTORY_COPY.albumRun({
        album: run.album,
        artist: run.artist,
        heard: run.tracksHeard,
        total: run.albumTracks,
        isWhole: run.isWhole,
      })}
    </th>
  </tr>
)

type PlayHistoryTableProps = {
  entries: readonly PlayHistoryEntry[]
  /** The account column's names; null for an account's own history, which has no such column. */
  nameOf: AccountName | null
}

/**
 * The history as a plain table, newest first and with no pictures: when each
 * sitting started, what played, what it belongs to, its library and how far
 * it got, and in everyone's history whose it was. A run of one album's
 * tracks is a row group of its own, under a heading that says how much of
 * the album played.
 */
export const PlayHistoryTable = ({ entries, nameOf }: PlayHistoryTableProps) => {
  const columns = nameOf ? [...OWN_COLUMNS, COLUMNS.account] : OWN_COLUMNS
  return (
    <div className={styles.room}>
      <table className={styles.table} aria-label={PLAY_HISTORY_COPY.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className={HEAD_CLASSES[column]}>
                {PLAY_HISTORY_COPY.columns[column]}
              </th>
            ))}
          </tr>
        </thead>
        {historyGroups(entries).map((group) => (
          <tbody key={group.key}>
            {group.run && <AlbumRunRow run={group.run} span={columns.length} />}
            {group.entries.map((entry) => (
              <EntryLine key={entry.id} entry={entry} nameOf={nameOf} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
