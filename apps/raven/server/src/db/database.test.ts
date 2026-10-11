import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { adoptLegacyDatabase, DatabaseService, MIGRATIONS } from '@/db/database'

describe('the database file', () => {
  const state = { dir: '' }
  const at = (name: string): string => join(state.dir, name)
  const files = async (): Promise<string[]> => (await readdir(state.dir)).toSorted()
  const seed = async ({ names }: { names: string[] }): Promise<void> => {
    await Promise.all(names.map((name) => writeFile(at(name), name)))
  }

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-db-'))
  })

  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it("opens weirwood's database under raven's name, rows and all", () => {
    const legacy = new Sqlite(at('weirwood.db'))
    legacy.exec("CREATE TABLE marker (note TEXT); INSERT INTO marker VALUES ('kept')")
    legacy.close()
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT note FROM marker').get()).toEqual({ note: 'kept' })
    database.onModuleDestroy()
    expect(existsSync(at('weirwood.db'))).toBe(false)
  })

  it('moves the WAL and shared-memory files with it', async () => {
    await seed({ names: ['weirwood.db', 'weirwood.db-wal', 'weirwood.db-shm'] })
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db', 'raven.db-shm', 'raven.db-wal'])
    expect(await readFile(at('raven.db-wal'), 'utf8')).toBe('weirwood.db-wal')
  })

  it('never replaces a raven.db that is already there', async () => {
    await writeFile(at('raven.db'), 'new')
    await writeFile(at('weirwood.db'), 'old')
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db', 'weirwood.db'])
    expect(await readFile(at('raven.db'), 'utf8')).toBe('new')
  })

  it('replaces an empty raven.db, which holds no database yet', async () => {
    await writeFile(at('raven.db'), '')
    await writeFile(at('weirwood.db'), 'old')
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db'])
    expect(await readFile(at('raven.db'), 'utf8')).toBe('old')
  })

  it('finishes a move that stopped before the database itself', async () => {
    await seed({ names: ['raven.db-wal', 'weirwood.db'] })
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db', 'raven.db-wal'])
  })

  it('leaves an empty data folder empty', async () => {
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual([])
  })
})

describe('migrations', () => {
  const state = { dir: '' }

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-migrate-'))
  })

  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it('gives a library made before settings existed the default settings', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 2).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 2')
    before.exec(
      "INSERT INTO libraries (name, created_at) VALUES ('Old', '2026-01-01T00:00:00.000Z')",
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(
      database.db
        .prepare('SELECT save_progress, pinned, sort, view_mode, group_by FROM libraries')
        .get(),
    ).toEqual({
      save_progress: 1,
      pinned: 1,
      sort: 'title',
      view_mode: 'grid',
      group_by: 'resolution',
    })
    database.onModuleDestroy()
  })

  it('gives a library made before ratings sources the TMDB one', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 8).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 8')
    before.exec(
      "INSERT INTO libraries (name, created_at, kind) VALUES ('Films', '2026-01-01T00:00:00.000Z', 'movies')",
    )
    before.close()
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT ratings_source FROM libraries').get()).toEqual({
      ratings_source: 'tmdb',
    })
    expect(database.db.prepare('SELECT COUNT(*) AS reviews FROM reviews').get()).toEqual({
      reviews: 0,
    })
    database.onModuleDestroy()
  })

  it('turns matching on for Movies and TV libraries and off for the rest', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 7).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 7')
    const library = before.prepare(
      "INSERT INTO libraries (name, created_at, kind) VALUES (?, '2026-01-01T00:00:00.000Z', ?)",
    )
    const media = before.prepare(
      `INSERT INTO media (library_id, path, file_name, folder, title, container, size, mtime_ms, added_at)
       VALUES (?, ?, 'x.mkv', '', 'x', 'mkv', 1, 1, '2026-01-01T00:00:00.000Z')`,
    )
    media.run(library.run('Films', 'movies').lastInsertRowid, '/films/x.mkv')
    media.run(library.run('Clips', 'other').lastInsertRowid, '/clips/x.mkv')
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT path, match, year FROM media ORDER BY path').all()).toEqual([
      { path: '/clips/x.mkv', match: 'off', year: null },
      { path: '/films/x.mkv', match: 'pending', year: null },
    ])
    expect(database.db.prepare('SELECT COUNT(*) AS items FROM items').get()).toEqual({ items: 0 })
    database.onModuleDestroy()
  })
})
