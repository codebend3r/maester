import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Logger } from '@nestjs/common'
import Sqlite from 'better-sqlite3'

/**
 * Brings `db` up to date: each migration moves the schema one version
 * forward and runs exactly once, tracked by SQLite's `user_version`, each in
 * its own transaction with the version bump, so a failed one leaves the
 * database at the version before it. Append new migrations; never edit a
 * shipped one, since existing databases have already run it.
 */
export const migrate = ({
  db,
  migrations,
}: {
  db: Sqlite.Database
  migrations: readonly string[]
}): void => {
  const current = Number(db.pragma('user_version', { simple: true }))
  migrations.slice(current).forEach((sql, offset) => {
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${current + offset + 1}`)
    })()
  })
}

const logger = new Logger('SQLite')

/** A refresh slower than this is logged, so its cost on a slow disk shows. */
const SLOW_REFRESH_MS = 100

/**
 * Brings the query planner's statistics in line with the data: SQLite's
 * `PRAGMA optimize` analyzes each table with rows whose indexes have none
 * yet, or whose size changed about tenfold since. That size is SQLite's
 * estimate from the table's b-tree, not a count, so a table can be analyzed
 * again after growing by less. Mask 0x10002 is what SQLite advises when a
 * long-lived connection opens, and it serves after a large write too: it
 * checks every table, not only those read since the connection opened, and
 * it leaves out bit 0x10, so an analysis counts every row instead of
 * sampling about 2000 per index. A sample judges a column of few values,
 * such as a library or an item type, far too selective, and the planner
 * picks worse plans from it. better-sqlite3 builds SQLite with STAT4, which
 * keeps sample values too, so a plan can hang on the values bound: a
 * statement is planned again on its first step after a bound value
 * changes, 2 to 7 microseconds each time. Nearly free when nothing grew.
 */
export const refreshStatistics = ({ db }: { db: Sqlite.Database }): void => {
  const start = performance.now()
  db.pragma('optimize = 0x10002')
  const ms = Math.round(performance.now() - start)
  if (ms <= SLOW_REFRESH_MS) return
  logger.log(`Refreshed the query planner's statistics of ${basename(db.name)} in ${ms} ms`)
}

/**
 * Opens `file` in `dataDir`, making the folder when it is missing, migrates
 * it and refreshes the planner's statistics. WAL lets reads go on while
 * something writes, and foreign keys are on, so `ON DELETE CASCADE` holds.
 */
export const openSqlite = ({
  dataDir,
  file,
  migrations,
}: {
  dataDir: string
  file: string
  migrations: readonly string[]
}): Sqlite.Database => {
  mkdirSync(dataDir, { recursive: true })
  const db = new Sqlite(join(dataDir, file))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate({ db, migrations })
  refreshStatistics({ db })
  return db
}
