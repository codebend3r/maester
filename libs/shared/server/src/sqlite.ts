import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * Opens `file` in `dataDir`, making the folder when it is missing, and
 * migrates it. WAL lets reads go on while something writes, and foreign keys
 * are on, so `ON DELETE CASCADE` holds.
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
  return db
}
