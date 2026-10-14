import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabase } from '@/test/database'
import { PRODUCTION_STATISTICS } from '@/test/queryPlans'

/**
 * Tables the copy has no statistics for, as `ANALYZE` gives an empty table
 * none: `ai_decisions` was empty on the real server, and `saga_backdrops`
 * came after the copy was taken.
 */
const NOT_IN_THE_COPY: readonly string[] = ['ai_decisions', 'saga_backdrops']

/** A `sqlite_stat1` row's table and index, as one comparable key. */
const keyOf = ({ table, index }: { table: string; index: string | null }): string =>
  `${table} ${index ?? '(no index)'}`

describe("the real server's statistics the plan tests copy", () => {
  const database = testDatabase('raven-statistics-copy-')

  beforeAll(() => database.open())
  afterAll(() => database.close())

  it('cover every index the schema has now, and every table with none', () => {
    const schema = database
      .get()
      .db.prepare<[], { tbl: string; idx: string | null }>(
        `SELECT t.name AS tbl, i.name AS idx
           FROM sqlite_master t
           LEFT JOIN sqlite_master i ON i.type = 'index' AND i.tbl_name = t.name
          WHERE t.type = 'table' AND t.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`,
      )
      .all()
      .filter(({ tbl }) => !NOT_IN_THE_COPY.includes(tbl))
      .map(({ tbl, idx }) => keyOf({ table: tbl, index: idx }))

    expect(
      PRODUCTION_STATISTICS.map(([table, index]) => keyOf({ table, index })).toSorted(),
    ).toEqual(schema.toSorted())
  })
})
