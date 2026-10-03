import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config.js'
import { adoptLegacyDatabase, DatabaseService } from '@/db/database.js'

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
