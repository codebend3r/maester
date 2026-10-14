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

  it('gives a library made before folder layouts the auto layout, and its paths none yet', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 18).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 18')
    before.exec(
      "INSERT INTO libraries (name, created_at) VALUES ('Anime', '2026-01-01T00:00:00.000Z')",
    )
    before.exec(
      "INSERT INTO library_paths (library_id, path, position) VALUES (1, '/media/Anime', 0)",
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT folder_layout FROM libraries').get()).toEqual({
      folder_layout: 'auto',
    })
    expect(database.db.prepare('SELECT layout, group_folders FROM library_paths').get()).toEqual({
      layout: null,
      group_folders: 0,
    })
    database.onModuleDestroy()
  })

  it("adds the AI lookup's decisions, none yet, gone with their library", () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 19).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 19')
    before.exec(
      "INSERT INTO libraries (name, created_at) VALUES ('TV', '2026-01-01T00:00:00.000Z')",
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    const count = () => database.db.prepare('SELECT COUNT(*) AS decisions FROM ai_decisions').get()
    expect(count()).toEqual({ decisions: 0 })
    database.db
      .prepare(
        `INSERT INTO ai_decisions (library_id, place, tmdb_id, title, year, poster, confidence, reason, model, decided_at)
         VALUES (1, 'Archie', NULL, NULL, NULL, NULL, 'low', 'Nothing fits.', 'claude-haiku-5-5', '2026-10-13T00:00:00.000Z')`,
      )
      .run()
    expect(count()).toEqual({ decisions: 1 })
    database.db.prepare('DELETE FROM libraries WHERE id = 1').run()
    expect(count()).toEqual({ decisions: 0 })
    database.onModuleDestroy()
  })

  it("gives every library its type's icon, and sends Sporting events files to be matched", () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 20).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 20')
    const library = before.prepare(
      "INSERT INTO libraries (name, created_at, kind) VALUES (?, '2026-01-01T00:00:00.000Z', ?)",
    )
    const media = before.prepare(
      `INSERT INTO media (library_id, path, file_name, folder, title, container, size, mtime_ms, added_at, match)
       VALUES (?, ?, 'x.mkv', '', 'x', 'mkv', 1, 1, '2026-01-01T00:00:00.000Z', 'off')`,
    )
    media.run(library.run('UFC', 'sports').lastInsertRowid, '/ufc/x.mkv')
    media.run(library.run('Clips', 'youtube').lastInsertRowid, '/clips/x.mkv')
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT name, icon FROM libraries ORDER BY id').all()).toEqual([
      { name: 'UFC', icon: null },
      { name: 'Clips', icon: null },
    ])
    expect(database.db.prepare('SELECT path, match FROM media ORDER BY path').all()).toEqual([
      { path: '/clips/x.mkv', match: 'off' },
      { path: '/ufc/x.mkv', match: 'pending' },
    ])
    database.onModuleDestroy()
  })

  it('keeps showing the edits made before shown_items read them by key', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 22).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 22')
    before.exec(
      `INSERT INTO items (id, type, tmdb_id, title, sort_title, year, tagline, fetched_at)
       VALUES (1, 'movie', '19995', 'Avatar', 'avatar', 2009, 'Enter the world.', '2026-01-01T00:00:00.000Z')`,
    )
    before.exec(
      `INSERT INTO item_overrides (item_id, title, sort_title, tagline)
       VALUES (1, 'Avatar (Theatrical Cut)', 'avatar theatrical cut', '')`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(
      database.db.prepare('SELECT title, sort_title, year, tagline FROM shown_items').get(),
    ).toEqual({
      title: 'Avatar (Theatrical Cut)',
      sort_title: 'avatar theatrical cut',
      year: 2009,
      tagline: null,
    })
    database.onModuleDestroy()
  })

  it("indexes each library's unmatched files, and its probed files by their frame", () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 23).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 23')
    const libraryId = before
      .prepare(
        "INSERT INTO libraries (name, created_at, kind) VALUES ('Movies', '2026-01-01T00:00:00.000Z', 'movies')",
      )
      .run().lastInsertRowid
    before
      .prepare(
        `INSERT INTO media (library_id, path, file_name, folder, title, container, size, mtime_ms, added_at, width, height)
         VALUES (?, '/m/x.mkv', 'x.mkv', '', 'x', 'mkv', 1, 1, '2026-01-01T00:00:00.000Z', 3840, 2160)`,
      )
      .run(libraryId)
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    const indexed = (index: string) => ({
      columns: database.db
        .prepare<[string], { name: string }>('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
        .all(index)
        .map((column) => column.name),
      isPartial: !!(
        database.db
          .prepare<[string], { partial: number }>(
            "SELECT partial FROM pragma_index_list('media') WHERE name = ?",
          )
          .get(index)?.partial ?? 0
      ),
    })
    expect(indexed('media_library_unmatched')).toEqual({ columns: ['library_id'], isPartial: true })
    expect(indexed('media_library_probed')).toEqual({
      columns: ['library_id', 'width', 'height'],
      isPartial: true,
    })
    expect(database.db.prepare('SELECT path, match, width, height FROM media').all()).toEqual([
      { path: '/m/x.mkv', match: 'pending', width: 3840, height: 2160 },
    ])
    database.onModuleDestroy()
  })
})
