import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSqlite } from '@/sqlite'

const FIRST = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);'
const SECOND = 'ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;'

describe('openSqlite', () => {
  const state = { dir: '' }
  const tables = (db: ReturnType<typeof openSqlite>): unknown[] =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
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
})
