import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSqlite, refreshStatistics } from '@/sqlite'

const FIRST = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);'
const SECOND = 'ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;'
const INDEXED = 'CREATE INDEX notes_body ON notes (body);'

type Database = ReturnType<typeof openSqlite>

const addNotes = ({ db, bodies }: { db: Database; bodies: readonly string[] }): void => {
  const insert = db.prepare('INSERT INTO notes (body) VALUES (?)')
  db.transaction(() => bodies.forEach((body) => insert.run(body)))()
}

/** `count` notes taking turns between two bodies, so the body index holds two values. */
const twoBodies = (count: number): string[] =>
  Array.from({ length: count }, (_, at) => (at % 2 === 0 ? 'a' : 'b'))

/** What the query planner knows of each index, by name: none before anything was analyzed. */
const statistics = (db: Database): Record<string, string> => {
  const isAnalyzed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'").get()
  if (!isAnalyzed) return {}
  return Object.fromEntries(
    db
      .prepare<[], { tbl: string; idx: string | null; stat: string }>(
        'SELECT tbl, idx, stat FROM sqlite_stat1',
      )
      .all()
      .map(({ tbl, idx, stat }) => [idx ?? tbl, stat]),
  )
}

describe('openSqlite', () => {
  const state = { dir: '' }
  /** The migrations' tables, leaving out SQLite's own, such as its statistics. */
  const tables = (db: Database): unknown[] =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (typeof row === 'object' && row != null && 'name' in row ? row.name : null))

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'shared-sqlite-'))
  })

  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it('makes the folder, runs every migration, and turns on WAL and foreign keys', () => {
    const dataDir = join(state.dir, 'nested', 'data')
    const db = openSqlite({ dataDir, file: 'test.db', migrations: [FIRST, SECOND] })
    expect(existsSync(join(dataDir, 'test.db'))).toBe(true)
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('runs only the migrations a database has not run yet', () => {
    const before = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST] })
    before.prepare("INSERT INTO notes (body) VALUES ('kept')").run()
    before.close()
    // FIRST would fail if it ran again, since the table exists.
    const after = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, SECOND] })
    expect(after.pragma('user_version', { simple: true })).toBe(2)
    expect(after.prepare('SELECT body, pinned FROM notes').all()).toEqual([
      { body: 'kept', pinned: 0 },
    ])
    after.close()
  })

  it('leaves a failed migration undone, at the version before it', () => {
    const broken = 'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;'
    expect(() =>
      openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, broken] }),
    ).toThrow()
    const db = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST] })
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(tables(db)).toEqual(['notes'])
    db.close()
  })

  it("gathers the query planner's statistics when the tables it opens hold rows", () => {
    const before = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, INDEXED] })
    addNotes({ db: before, bodies: twoBodies(4) })
    before.close()
    const db = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, INDEXED] })
    expect(statistics(db)).toEqual({ notes_body: '4 2' })
    db.close()
  })

  it('counts every row rather than a sample, so a column of few values never looks selective', () => {
    const before = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, INDEXED] })
    addNotes({ db: before, bodies: twoBodies(6000) })
    before.close()
    const db = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, INDEXED] })
    expect(statistics(db)).toEqual({ notes_body: '6000 3000' })
    db.close()
  })
})

describe('refreshStatistics', () => {
  const state = { dir: '' }

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'shared-statistics-'))
  })

  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it('gathers statistics for a table that has rows now, and again once it grows tenfold', () => {
    const db = openSqlite({ dataDir: state.dir, file: 'test.db', migrations: [FIRST, INDEXED] })
    expect(statistics(db)).toEqual({})
    addNotes({ db, bodies: twoBodies(4) })
    refreshStatistics({ db })
    expect(statistics(db)).toEqual({ notes_body: '4 2' })
    // Nothing has read the table on this connection, which SQLite's default
    // optimize waits for before it looks at a table's size again.
    addNotes({ db, bodies: twoBodies(396) })
    refreshStatistics({ db })
    expect(statistics(db)).toEqual({ notes_body: '400 200' })
    db.close()
  })
})
