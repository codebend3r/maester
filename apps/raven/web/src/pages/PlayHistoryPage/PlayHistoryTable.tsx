import {
  type AlbumRun,
  HISTORY_ROW_KINDS,
  type HistoryRow,
  type PlayHistoryEntry,
  historyRows,
  playedContext,
  reachOf,
} from '@raven/core'
import type { ComponentType } from 'react'
import { PLAY_HISTORY_COPY } from '@/pages/PlayHistoryPage/copy'
import styles from '@/pages/PlayHistoryPage/PlayHistoryPage.module.scss'

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** How a table names an account: by its email when the owner's list has it. */
export type AccountName = (accountId: string) => string

type RowViewProps = {
  row: HistoryRow
  /** The account column's names; absent from an account's own history, which has no such column. */
  nameOf: AccountName | null
  columns: number
}

type EntryLineProps = { entry: PlayHistoryEntry; nameOf: AccountName | null }

const EntryLine = ({ entry, nameOf }: EntryLineProps) => {
  return (
    <tr>
      <td className={styles.when}>
        <time dateTime={entry.startedAt}>{when.format(new Date(entry.startedAt))}</time>
      </td>
      <th scope="row" className={styles.title}>
        {entry.played.title}
      </th>
      <td className={styles.from}>{playedContext(entry.played)}</td>
      <td className={styles.library}>{entry.libraryName}</td>
      <td className={styles.reach}>{PLAY_HISTORY_COPY.reach(reachOf(entry))}</td>
      {nameOf && <td className={styles.account}>{nameOf(entry.accountId)}</td>}
    </tr>
  )
}

const EntryRow = ({ row, nameOf }: RowViewProps) =>
  row.kind === HISTORY_ROW_KINDS.entry && <EntryLine entry={row.entry} nameOf={nameOf} />

type AlbumHeadingProps = { run: AlbumRun }

const AlbumHeading = ({ run }: AlbumHeadingProps) =>
  PLAY_HISTORY_COPY.albumRun({
    album: run.album,
    artist: run.artist,
    heard: run.tracksHeard,
    total: run.albumTracks,
    isWhole: run.isWhole,
  })

const AlbumRunRow = ({ row, columns }: RowViewProps) =>
  row.kind === HISTORY_ROW_KINDS.album && (
    <tr className={styles.run}>
      <th scope="rowgroup" colSpan={columns}>
        <AlbumHeading run={row.run} />
      </th>
    </tr>
  )

const ROW_VIEWS = {
  [HISTORY_ROW_KINDS.entry]: EntryRow,
  [HISTORY_ROW_KINDS.album]: AlbumRunRow,
} as const satisfies Record<HistoryRow['kind'], ComponentType<RowViewProps>>

type PlayHistoryTableProps = {
  entries: readonly PlayHistoryEntry[]
  nameOf: AccountName | null
}

/**
 * The history as a plain table, newest first and with no pictures: when each
 * sitting started, what played, what it belongs to, its library and how far
 * it got, and in everyone's history whose it was. A run of one album's
 * tracks sits under a heading that says how much of the album played.
 */
export const PlayHistoryTable = ({ entries, nameOf }: PlayHistoryTableProps) => {
  const columns = nameOf ? 6 : 5
  return (
    <div className={styles.room}>
      <table className={styles.table} aria-label={PLAY_HISTORY_COPY.table}>
        <thead>
          <tr>
            <th scope="col">{PLAY_HISTORY_COPY.columns.when}</th>
            <th scope="col">{PLAY_HISTORY_COPY.columns.title}</th>
            <th scope="col" className={styles.from}>
              {PLAY_HISTORY_COPY.columns.from}
            </th>
            <th scope="col" className={styles.library}>
              {PLAY_HISTORY_COPY.columns.library}
            </th>
            <th scope="col">{PLAY_HISTORY_COPY.columns.reach}</th>
            {nameOf && <th scope="col">{PLAY_HISTORY_COPY.columns.account}</th>}
          </tr>
        </thead>
        <tbody>
          {historyRows(entries).map((row) => {
            const Row = ROW_VIEWS[row.kind]
            return <Row key={row.key} row={row} nameOf={nameOf} columns={columns} />
          })}
        </tbody>
      </table>
    </div>
  )
}
