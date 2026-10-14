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
