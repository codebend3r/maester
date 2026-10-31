import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUG_REPORT_STATUSES, ITEM_TYPES } from '@raven/core'
import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { adoptLegacyDatabase, DatabaseService, MIGRATIONS } from '@/db/database'
import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { PLAY_KINDS } from '@/media/watchedRepository'
import { LOUDNESS_STATES, REPLAYGAIN_SOURCES } from '@/music/loudness'

/** A kind of play the `plays.kind` CHECK refuses. */
const UNKNOWN_PLAY_KIND = 'bogus'

describe('the database file', () => {
  const state = { dir: '' }
  const at = (name: string): string => join(state.dir, name)
  const files = async (): Promise<string[]> => (await readdir(state.dir)).toSorted()
  type SeedProps = { names: string[] }

  const seed = async ({ names }: SeedProps): Promise<void> => {
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

  it('gives a library made before ratings sources the Metacritic one, by way of TMDB', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 8).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 8')
    before.exec(
      "INSERT INTO libraries (name, created_at, kind) VALUES ('Films', '2026-01-01T00:00:00.000Z', 'movies')",
    )
    before.close()
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT ratings_source FROM libraries').get()).toEqual({
      ratings_source: 'metacritic',
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

  it('gives a library made before scan times were kept none yet', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 25).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 25')
    before.exec(
      "INSERT INTO libraries (name, created_at) VALUES ('Movies', '2026-01-01T00:00:00.000Z')",
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(
      database.db.prepare('SELECT full_scanned_at, quick_scanned_at FROM libraries').get(),
    ).toEqual({ full_scanned_at: null, quick_scanned_at: null })
    database.onModuleDestroy()
  })

  it('kinds the plays, moves the old default to 95 and drops the spots a watched play would have cleared', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 24).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 24')
    const library = before.prepare(
      `INSERT INTO libraries (name, created_at, watched_percent) VALUES (?, '2026-01-01T00:00:00.000Z', ?)`,
    )
    const standard = Number(library.run('Standard', 90).lastInsertRowid)
    const lenient = Number(library.run('Lenient', 80).lastInsertRowid)
    const file = before.prepare(
      `INSERT INTO media (library_id, path, file_name, folder, title, container, size, mtime_ms, added_at, duration)
       VALUES (?, ?, ?, '', ?, 'mkv', 1, 1, '2026-01-01T00:00:00.000Z', ?)`,
    )
    type AddProps = {
      libraryId: number
      name: string
      duration: number | null
    }

    const add = ({ libraryId, name, duration }: AddProps) =>
      Number(file.run(libraryId, `/${name}.mkv`, `${name}.mkv`, name, duration).lastInsertRowid)
    const between = add({ libraryId: standard, name: 'between', duration: 100 })
    const past = add({ libraryId: standard, name: 'past', duration: 100 })
    const lenientPast = add({ libraryId: lenient, name: 'lenient', duration: 100 })
    const lenientBefore = add({ libraryId: lenient, name: 'lenient-before', duration: 100 })
    const unknown = add({ libraryId: standard, name: 'unknown', duration: null })
    const progress = before.prepare(
      "INSERT INTO playback_progress (media_id, position, updated_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z')",
    )
    progress.run(between, 92)
    progress.run(past, 95)
    progress.run(lenientPast, 80)
    progress.run(lenientBefore, 79)
    progress.run(unknown, 5000)
    before
      .prepare(
        "INSERT INTO plays (media_id, played_at, furthest) VALUES (?, '2026-01-01T00:00:00.000Z', 91)",
      )
      .run(between)
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT kind, furthest FROM plays').all()).toEqual([
      { kind: 'played', furthest: 91 },
    ])
    expect(
      database.db.prepare('SELECT name, watched_percent FROM libraries ORDER BY id').all(),
    ).toEqual([
      { name: 'Standard', watched_percent: 95 },
      { name: 'Lenient', watched_percent: 80 },
    ])
    expect(
      database.db.prepare('SELECT media_id FROM playback_progress ORDER BY media_id').all(),
    ).toEqual([{ media_id: between }, { media_id: lenientBefore }, { media_id: unknown }])
    expect(() =>
      database.db
        .prepare("INSERT INTO plays (media_id, played_at, kind) VALUES (?, 'x', 'skipped')")
        .run(between),
    ).toThrow()
    database.onModuleDestroy()
  })

  it("marks the scores kept before as OMDb's, and TMDB's as TMDB's", () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 28).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 28')
    before.exec(
      `INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at, omdb_fetched_at)
       VALUES (1, 'movie', '603', 'The Matrix', 'matrix', '2026-01-01', '2026-01-02');
       INSERT INTO ratings (item_id, source, value, votes) VALUES
         (1, 'tmdb', 8.2, 100), (1, 'imdb', 8.7, NULL), (1, 'rottenTomatoes', 8.3, NULL);`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(
      database.db.prepare('SELECT source, provider FROM ratings ORDER BY source').all(),
    ).toEqual([
      { source: 'imdb', provider: 'omdb' },
      { source: 'rottenTomatoes', provider: 'omdb' },
      { source: 'tmdb', provider: 'tmdb' },
    ])
    expect(
      database.db.prepare('SELECT omdb_fetched_at, mdblist_fetched_at FROM items').get(),
    ).toEqual({ omdb_fetched_at: '2026-01-02', mdblist_fetched_at: null })
    database.onModuleDestroy()
  })

  it('gives every viewing row to the local account, leaving out rows whose video or title is gone', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    // The version just before the account migration.
    const shipped = 30
    MIGRATIONS.slice(0, shipped).forEach((sql) => before.exec(sql))
    before.pragma(`user_version = ${shipped}`)
    before
      .prepare(
        `INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at)
         VALUES (1, ?, '700', 'Andor', 'andor', '2026-01-01')`,
      )
      .run(ITEM_TYPES.show)
    before.exec(
      `INSERT INTO libraries (id, name, created_at) VALUES (1, 'Movies', '2026-01-01T00:00:00.000Z');
       INSERT INTO media (id, library_id, path, file_name, folder, title, container, size, mtime_ms, added_at)
       VALUES (1, 1, '/m/Heat.mkv', 'Heat.mkv', '', 'Heat', 'mkv', 1, 1, '2026-01-01T00:00:00.000Z');
       INSERT INTO playback_progress (media_id, position, updated_at) VALUES (1, 30, '2026-01-02');
       INSERT INTO favourites (media_id, added_at) VALUES (1, '2026-01-03');
       INSERT INTO item_favourites (item_id, added_at) VALUES (1, '2026-01-04');`,
    )
    // An old database that once ran without foreign keys can hold rows whose video or title is gone.
    before.pragma('foreign_keys = OFF')
    before.exec(
      `INSERT INTO playback_progress (media_id, position, updated_at) VALUES (99, 30, '2026-01-02');
       INSERT INTO favourites (media_id, added_at) VALUES (99, '2026-01-03');
       INSERT INTO item_favourites (item_id, added_at) VALUES (99, '2026-01-04');`,
    )
    const play = before.prepare(
      "INSERT INTO plays (media_id, played_at, furthest, kind) VALUES (1, '2026-01-05', 60, ?)",
    )
    play.run(PLAY_KINDS.played)
    play.run(PLAY_KINDS.marked)
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    const { db } = database
    expect(db.pragma('foreign_key_check')).toEqual([])
    const local = { account_id: VIEWING_ACCOUNTS.local }
    expect(
      db.prepare('SELECT account_id, media_id, position FROM playback_progress').all(),
    ).toEqual([{ ...local, media_id: 1, position: 30 }])
    expect(db.prepare('SELECT account_id, media_id, added_at FROM favourites').all()).toEqual([
      { ...local, media_id: 1, added_at: '2026-01-03' },
    ])
    expect(db.prepare('SELECT account_id, item_id, added_at FROM item_favourites').all()).toEqual([
      { ...local, item_id: 1, added_at: '2026-01-04' },
    ])
    expect(db.prepare('SELECT account_id, kind FROM plays ORDER BY id').all()).toEqual([
      { ...local, kind: PLAY_KINDS.played },
      { ...local, kind: PLAY_KINDS.marked },
    ])
    expect(() =>
      db
        .prepare(
          "INSERT INTO plays (account_id, media_id, played_at, kind) VALUES (?, 1, '2026-01-06', ?)",
        )
        .run(VIEWING_ACCOUNTS.local, UNKNOWN_PLAY_KIND),
    ).toThrow()
    db.prepare('DELETE FROM media WHERE id = 1').run()
    expect(
      db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM playback_progress) AS spots,
                  (SELECT COUNT(*) FROM favourites) AS favourites,
                  (SELECT COUNT(*) FROM plays) AS plays`,
        )
        .get(),
    ).toEqual({ spots: 0, favourites: 0, plays: 0 })
    db.prepare('DELETE FROM items WHERE id = 1').run()
    expect(db.prepare('SELECT COUNT(*) AS rows FROM item_favourites').get()).toEqual({ rows: 0 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    database.onModuleDestroy()
  })

  it('adds bug reports, none yet, each kept as valid JSON', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 31).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 31')
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    const count = () => database.db.prepare('SELECT COUNT(*) AS reports FROM bug_reports').get()
    expect(count()).toEqual({ reports: 0 })
    const insert = database.db.prepare(
      `INSERT INTO bug_reports (account_id, media_id, title, summary, status, diagnostics, created_at, updated_at)
       VALUES (?, NULL, 'Heat', 'It stopped.', ?, ?, '2026-10-20', '2026-10-20')`,
    )
    insert.run(VIEWING_ACCOUNTS.local, BUG_REPORT_STATUSES.new, '{"problems":[]}')
    expect(count()).toEqual({ reports: 1 })
    expect(() => insert.run(VIEWING_ACCOUNTS.local, BUG_REPORT_STATUSES.new, 'not json')).toThrow()
    database.onModuleDestroy()
  })

  it('adds a keyframes column, empty, beside the tracks of a version-32 database', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 32).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 32')
    before.exec(
      `INSERT INTO libraries (id, name, created_at) VALUES (1, 'Test', '2026-01-01');
       INSERT INTO media (id, library_id, path, file_name, folder, title, container, size, mtime_ms, added_at)
       VALUES (1, 1, '/m/a.mkv', 'a.mkv', '/m', 'a', 'mkv', 1, 1, '2026-01-01');`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    expect(database.db.prepare('SELECT keyframes FROM media').get()).toEqual({ keyframes: null })
    database.onModuleDestroy()
  })

  it('moves the libraries still on TMDB scores to Metacritic, keeping any other choice', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 35).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 35')
    before.exec(
      `INSERT INTO libraries (id, name, created_at, ratings_source) VALUES (1, 'Films', '2026-01-01', 'tmdb');
       INSERT INTO libraries (id, name, created_at, ratings_source) VALUES (2, 'Shows', '2026-01-01', 'imdb');`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT ratings_source FROM libraries ORDER BY id').all()).toEqual([
      { ratings_source: 'metacritic' },
      { ratings_source: 'imdb' },
    ])
    database.onModuleDestroy()
  })

  it('gives a picture chosen for a title to each library holding it, and keeps none for the title', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 36).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 36')
    before.exec(
      `INSERT INTO libraries (id, name, created_at) VALUES (1, '4K Movies', '2026-01-01'), (2, 'Movies', '2026-01-01'), (3, 'Other', '2026-01-01');
       INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at) VALUES (1, 'show', '9', 'Andor', 'Andor', '2026-01-01');
       INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at, parent_id, number) VALUES (2, 'season', '9:1', 'Season 1', 'Season 1', '2026-01-01', 1, 1);
       INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at, parent_id, number) VALUES (3, 'episode', '9:1:1', 'One', 'One', '2026-01-01', 2, 1);
       INSERT INTO media (id, library_id, path, file_name, folder, title, container, size, mtime_ms, added_at)
       VALUES (1, 1, '/a/one.mkv', 'one.mkv', '/a', 'one', 'mkv', 1, 1, '2026-01-01'),
              (2, 2, '/b/one.mkv', 'one.mkv', '/b', 'one', 'mkv', 1, 1, '2026-01-01');
       INSERT INTO media_items (media_id, item_id) VALUES (1, 3), (2, 3);
       INSERT INTO item_images (item_id, kind, source, ref) VALUES (1, 'poster', 'chosen', '/picked.jpg'), (1, 'poster', 'tmdb', '/own.jpg');`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(
      database.db
        .prepare(
          'SELECT library_id, item_id, kind, ref FROM library_item_images ORDER BY library_id',
        )
        .all(),
    ).toEqual([
      { library_id: 1, item_id: 1, kind: 'poster', ref: '/picked.jpg' },
      { library_id: 2, item_id: 1, kind: 'poster', ref: '/picked.jpg' },
    ])
    expect(database.db.prepare('SELECT source FROM item_images').all()).toEqual([
      { source: 'tmdb' },
    ])
    database.onModuleDestroy()
  })

  it('waits a version-44 database’s tracks for the loudness scan, naming the gains their tags gave', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 44).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 44')
    before.exec(
      `INSERT INTO libraries (id, name, created_at, kind) VALUES (1, 'Music', '2026-01-01', 'music');
       INSERT INTO media (id, library_id, path, file_name, folder, title, container, size, mtime_ms, added_at)
       VALUES (1, 1, '/m/a.flac', 'a.flac', '/m', 'a', 'flac', 1, 1, '2026-01-01'),
              (2, 1, '/m/b.flac', 'b.flac', '/m', 'b', 'flac', 1, 1, '2026-01-01');
       INSERT INTO albums (id, library_id, album_key, title, sort_title, replaygain_gain, added_at)
       VALUES (1, 1, 'a', 'A', 'A', -7.5, '2026-01-01'), (2, 1, 'b', 'B', 'B', NULL, '2026-01-01');
       INSERT INTO tracks (media_id, album_id, title, replaygain_gain) VALUES (1, 1, 'a', -6.5), (2, 2, 'b', NULL);`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    expect(
      database.db
        .prepare(
          'SELECT loudness_state, loudness_version, replaygain_source FROM tracks ORDER BY media_id',
        )
        .all(),
    ).toEqual([
      {
        loudness_state: LOUDNESS_STATES.pending,
        loudness_version: 0,
        replaygain_source: REPLAYGAIN_SOURCES.tags,
      },
      { loudness_state: LOUDNESS_STATES.pending, loudness_version: 0, replaygain_source: null },
    ])
    expect(database.db.prepare('SELECT replaygain_source FROM albums ORDER BY id').all()).toEqual([
      { replaygain_source: REPLAYGAIN_SOURCES.tags },
      { replaygain_source: null },
    ])
    database.onModuleDestroy()
  })

  it('gives a version-45 database an empty similar artists cache and an index of when albums came', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 45).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 45')
    before.exec(
      `INSERT INTO artists (id, name, sort_name, name_key, mbid) VALUES (1, 'Band', 'Band', 'band', NULL);`,
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.pragma('user_version', { simple: true })).toBe(46)
    expect(MIGRATIONS).toHaveLength(46)
    database.db
      .prepare(
        `INSERT INTO similar_artists (artist_id, similar_id, score, fetched_at)
         VALUES (1, '9c9f1380-2516-4fc9-a3e6-f9f61941d090', 10, '2026-10-31')`,
      )
      .run()
    database.db.prepare('DELETE FROM artists WHERE id = 1').run()
    expect(database.db.prepare('SELECT * FROM similar_artists').all()).toEqual([])
    expect(
      database.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'albums_added'")
        .all(),
    ).toEqual([{ name: 'albums_added' }])
    database.onModuleDestroy()
  })
})
