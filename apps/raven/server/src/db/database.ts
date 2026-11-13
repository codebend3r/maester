import { existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { openSqlite, refreshStatistics } from '@shared/server'
import type Sqlite from 'better-sqlite3'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { MIGRATIONS } from '@/db/migrations'

/** The index's file in the data folder. Before raven was renamed it was `weirwood.db`. */
const DATABASE_FILE = 'raven.db'
const LEGACY_FILE = 'weirwood.db'

/**
 * SQLite keeps recent writes in `-wal` until they are copied into the
 * database, and an index of them in `-shm`, both named after the database, so
 * they move with it. The database itself moves last: a move cut short leaves
 * it under its old name, and the next start finishes the job.
 */
const MOVE_ORDER: readonly string[] = ['-wal', '-shm', '']

type AdoptLegacyDatabaseProps = { dataDir: string }

/**
 * Renames weirwood's database in `dataDir` to raven's, once, so the index,
 * progress and favourites carry over. Does nothing when raven's file already
 * holds a database or there is nothing to adopt. A zero-byte file holds none
 * yet (SQLite writes its header on first use), so it is replaced. Call it
 * before opening.
 */
export const adoptLegacyDatabase = ({ dataDir }: AdoptLegacyDatabaseProps): void => {
  const target = join(dataDir, DATABASE_FILE)
  const legacy = join(dataDir, LEGACY_FILE)
  const holdsDatabase = existsSync(target) && statSync(target).size > 0
  if (holdsDatabase || !existsSync(legacy)) return
  MOVE_ORDER.filter((suffix) => existsSync(legacy + suffix)).forEach((suffix) =>
    renameSync(legacy + suffix, target + suffix),
  )
}

/** The one SQLite connection: libraries and their settings, media metadata, playback progress, favourites and plays. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Sqlite.Database

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    adoptLegacyDatabase({ dataDir: config.dataDir })
    // WAL lets the API read while a scan writes, which is most of the time.
    this.db = openSqlite({ dataDir: config.dataDir, file: DATABASE_FILE, migrations: MIGRATIONS })
  }

  /**
   * Brings the query planner's statistics in line with the rows, after work
   * that can add or remove thousands of them: a scan, or a matching pass.
   */
  refreshStatistics(): void {
    refreshStatistics({ db: this.db })
  }

  onModuleDestroy(): void {
    this.db.close()
  }
}
