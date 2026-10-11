import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'

/**
 * A fresh database in a folder of its own, for one block of tests: hand
 * `open` to `beforeAll` and `close` to `afterAll`, and `get` it in between.
 */
export const testDatabase = (prefix: string) => {
  const state: { dir: string; database: DatabaseService | null } = { dir: '', database: null }
  return {
    open: async (): Promise<void> => {
      state.dir = await mkdtemp(join(tmpdir(), prefix))
      state.database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    },
    close: async (): Promise<void> => {
      state.database?.onModuleDestroy()
      await rm(state.dir, { recursive: true, force: true })
    },
    /** The folder it lives in, for files a test wants beside it. */
    dir: (): string => state.dir,
    get: (): DatabaseService => {
      if (!state.database) throw new Error('The test database is not open')
      return state.database
    },
  }
}
