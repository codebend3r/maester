import { refreshStatistics } from '@shared/server'
import Sqlite from 'better-sqlite3'
import type { DatabaseService } from '@/db/database'

type PlanRow = { id: number; parent: number; detail: string }

/** One step of SQLite's plan for a statement, with the steps it sits inside, outermost first. */
export type PlanStep = { detail: string; within: readonly string[] }

const stepsOf = (rows: readonly PlanRow[]): PlanStep[] => {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const within = (row: PlanRow): string[] => {
    const parent = byId.get(row.parent)
    return parent ? [...within(parent), parent.detail] : []
  }
  return rows.map((row) => ({ detail: row.detail, within: within(row) }))
}

/**
 * `sqlite_stat1` as `ANALYZE` left it on a copy of a real server's database:
 * 61k files and 54k items in 11 libraries. Counts only, by table and index;
 * a table with no index has a row count alone, and an empty table none.
 * To take them again, open a copy with the server (or run `ANALYZE` on it),
 * then `SELECT tbl, idx, stat FROM sqlite_stat1 ORDER BY tbl, idx`.
 * `queryPlans.test.ts` fails when the schema gains or loses an index.
 */
export const PRODUCTION_STATISTICS = [
  ['credits', 'credits_person', '669689 4'],
  ['credits', 'sqlite_autoindex_credits_1', '669689 17 1 1'],
  ['favourites', null, '1'],
  ['item_images', 'sqlite_autoindex_item_images_1', '56977 2 1 1'],
  ['item_overrides', null, '1'],
  ['items', 'items_parent', '53629 11 2'],
  ['items', 'sqlite_autoindex_items_1', '53629 13408 1'],
  ['libraries', null, '11'],
  ['library_paths', 'sqlite_autoindex_library_paths_1', '17 2 1'],
  ['match_overrides', 'sqlite_autoindex_match_overrides_1', '5 2 1'],
  ['media', 'media_library_added', '60708 5519 35'],
  ['media', 'media_library_changed', '60708 5519 35'],
  ['media', 'media_library_probed', '60642 5513 149 77'],
  ['media', 'media_library_title', '60708 5519 1'],
  ['media', 'media_library_unmatched', '95 32'],
  ['media', 'media_match_pending', '653 653'],
  ['media', 'media_thumbnail_pending', '5 5'],
  ['media', 'sqlite_autoindex_media_1', '60708 5519 1'],
  ['media_items', 'media_items_item', '54459 2'],
  ['media_items', 'sqlite_autoindex_media_items_1', '54459 1 1'],
  ['people', 'sqlite_autoindex_people_1', '171416 1'],
  ['playback_progress', null, '11'],
  ['plays', 'plays_media', '8 1 1'],
  ['ratings', 'sqlite_autoindex_ratings_1', '45400 1 1'],
  ['reviews', 'reviews_item', '13510 4 1'],
  ['reviews', 'sqlite_autoindex_reviews_1', '13510 1'],
  ['settings', 'sqlite_autoindex_settings_1', '1 1'],
] as const

/**
 * Makes a test database plan as that real one does, whatever few rows the
 * test added: its statistics are replaced by the real ones. The STAT4
 * samples `ANALYZE` draws from the test's own rows are dropped, so the real
 * counts alone guide the planner. Never refresh the statistics after this:
 * a refresh sees the test's few rows against the copied counts and
 * analyzes again, putting the test's own counts back.
 */
export const planLikeProduction = (database: DatabaseService): void => {
  const { db } = database
  db.exec('ANALYZE')
  db.exec('DELETE FROM sqlite_stat1')
  db.exec('DELETE FROM sqlite_stat4')
  const insert = db.prepare('INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES (?, ?, ?)')
  PRODUCTION_STATISTICS.forEach(([table, index, stat]) => insert.run(table, index, stat))
  // SQLite gathers nothing for its own tables, so this only reloads the statistics.
  db.exec('ANALYZE sqlite_schema')
}

/**
 * A second connection to a test database that keeps each statement it runs,
 * so a test can ask SQLite how it ran them: hand `database` to the
 * repositories under test, then read `steps`. better-sqlite3 runs no
 * statement with a parameter unbound, so each is traced with its values
 * written in rather than read off the source. It cuts each string value
 * longer than 32 bytes, which leaves a `json_each` list malformed to run but
 * planned the same, as SQLite plans without reading it.
 */
export const tracedDatabase = (database: DatabaseService) => {
  const statements: string[] = []
  const db = new Sqlite(database.db.name, {
    verbose: (sql) => {
      if (typeof sql === 'string') statements.push(sql)
    },
  })
  const traced: DatabaseService = {
    db,
    refreshStatistics: () => refreshStatistics({ db }),
    onModuleDestroy: () => db.close(),
  }
  return {
    database: traced,
    /** Every step of every statement run so far, in the order they ran. */
    steps: (): PlanStep[] =>
      statements.flatMap((sql) =>
        stepsOf(database.db.prepare<[], PlanRow>(`EXPLAIN QUERY PLAN ${sql}`).all()),
      ),
  }
}
