import { join } from 'node:path'
import { isRecord, isString } from '@raven/core'
import type { SafeStorage as ElectronSafeStorage } from 'electron'
import { parseJson } from '@/main/parseJson'
import { isMissingFile } from '@/main/stateStore'
import { isOpaqueId } from '@/shared/protocol'

export type SafeStorage = Pick<
  ElectronSafeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
>

/** The parts of `node:fs/promises` the store uses; `remove` never fails on a missing file. */
export type SessionFs = {
  readFile: (path: string) => Promise<Buffer>
  writeFile: (input: { path: string; data: Buffer; mode: number }) => Promise<void>
  rename: (input: { from: string; to: string }) => Promise<void>
  remove: (path: string) => Promise<void>
  mkdir: (input: { path: string; mode: number }) => Promise<void>
  readdir: (path: string) => Promise<readonly string[]>
}

/** The storage auth-js keeps a server's session in, one per server. */
export type SessionStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export type SessionStore = {
  storageFor: (serverId: string) => SessionStorage
  isRemembered: () => boolean
  forget: (serverId: string) => Promise<void>
  clearOrphans: (input: { keep: readonly string[] }) => Promise<void>
}

/** The folder under userData that holds one encrypted file per signed in server. */
export const ACCOUNTS_DIR = 'accounts'

export const SAFE_STORAGE_HOOK = 'RAVEN_DESKTOP_SAFE_STORAGE'
export const SAFE_STORAGE_OFF = 'off'
const BLOB_EXTENSION = '.bin'
const TMP_EXTENSION = '.tmp'
const DIR_MODE = 0o700
const FILE_MODE = 0o600

type Items = Readonly<Record<string, string>>

type Held = { items: Promise<Items>; written: Promise<void> }

const EMPTY: Items = {}

const isItems = (value: unknown): value is Items =>
  isRecord(value) && Object.values(value).every(isString)

/** The test hook: unpackaged, `RAVEN_DESKTOP_SAFE_STORAGE=off` keeps sign-ins in memory alone. */
export const isForcedMemoryFrom = ({
  isPackaged,
  env,
}: {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
}): boolean => !isPackaged && env[SAFE_STORAGE_HOOK] === SAFE_STORAGE_OFF

// The id names a file on disk.
const checkId = (serverId: string): void => {
  if (!isOpaqueId(serverId)) throw new Error('That is not a server id.')
}

const serverIdOf = (name: string): string | null => {
  if (!name.endsWith(BLOB_EXTENSION)) return null
  const id = name.slice(0, -BLOB_EXTENSION.length)
  return isOpaqueId(id) ? id : null
}

/**
 * Each server's sign-in, kept as one `safeStorage` encrypted file holding auth-js's whole
 * storage map. Without encryption, or under the test hook, it lives in memory alone and a
 * relaunch is signed out. Nothing it writes or warns ever holds a token.
 */
export const createSessionStore = ({
  dir,
  safeStorage,
  isForcedMemory,
  fs,
  warn,
}: {
  dir: string
  safeStorage: SafeStorage
  isForcedMemory: boolean
  fs: SessionFs
  warn: (message: string) => void
}): SessionStore => {
  let servers: ReadonlyMap<string, Held> = new Map()

  const isRemembered = (): boolean => !isForcedMemory && safeStorage.isEncryptionAvailable()

  const fileOf = (serverId: string): string => {
    checkId(serverId)
    return join(dir, `${serverId}${BLOB_EXTENSION}`)
  }

  const removeFile = (file: string): Promise<void> => fs.remove(file).catch(() => undefined)

  const decrypt = (data: Buffer): unknown => {
    try {
      return parseJson(safeStorage.decryptString(data))
    } catch {
      return undefined
    }
  }

  // Never rejects: whatever cannot be read is removed and reads as signed out.
  const load = async (serverId: string): Promise<Items> => {
    const file = fileOf(serverId)
    if (!isRemembered()) {
      await removeFile(file)
      return EMPTY
    }
    const read = await fs.readFile(file).then(
      (data) => ({ isFound: true as const, data }),
      (error: unknown) => ({ isFound: false as const, error }),
    )
    if (!read.isFound && isMissingFile(read.error)) return EMPTY
    const value = read.isFound ? decrypt(read.data) : undefined
    if (isItems(value)) return value
    warn(`raven player could not read the sign-in it kept for server ${serverId}, so it removed it`)
    await removeFile(file)
    return EMPTY
  }

  // Never rejects either: a failed write keeps the sign-in for this run alone.
  const save = async ({ serverId, items }: { serverId: string; items: Items }): Promise<void> => {
    if (!isRemembered()) return
    const file = fileOf(serverId)
    try {
      if (Object.keys(items).length === 0) {
        await fs.remove(file)
        return
      }
      const tmp = `${file}${TMP_EXTENSION}`
      await fs.mkdir({ path: dir, mode: DIR_MODE })
      await fs.writeFile({
        path: tmp,
        data: safeStorage.encryptString(JSON.stringify(items)),
        mode: FILE_MODE,
      })
      await fs.rename({ from: tmp, to: file })
    } catch {
      warn(`raven player could not keep the sign-in for server ${serverId} on this Mac`)
    }
  }

  const heldOf = (serverId: string): Held => {
    const known = servers.get(serverId)
    if (known !== undefined) return known
    const made = { items: load(serverId), written: Promise.resolve() }
    servers = new Map([...servers, [serverId, made]])
    return made
  }

  const change = ({
    serverId,
    edit,
  }: {
    serverId: string
    edit: (items: Items) => Items
  }): Promise<void> => {
    const held = heldOf(serverId)
    const items = held.items.then(edit)
    const written = Promise.all([held.written, items]).then(([, next]) =>
      save({ serverId, items: next }),
    )
    servers = new Map([...servers, [serverId, { items, written }]])
    return written
  }

  const storageFor = (serverId: string): SessionStorage => {
    checkId(serverId)
    return {
      getItem: async (key) => (await heldOf(serverId).items)[key] ?? null,
      setItem: (key, value) => change({ serverId, edit: (items) => ({ ...items, [key]: value }) }),
      removeItem: (key) =>
        change({
          serverId,
          edit: (items) =>
            Object.fromEntries(Object.entries(items).filter(([name]) => name !== key)),
        }),
    }
  }

  const forget = async (serverId: string): Promise<void> => {
    const file = fileOf(serverId)
    const held = servers.get(serverId)
    servers = new Map([...servers].filter(([id]) => id !== serverId))
    if (held !== undefined) await held.written
    await fs.remove(file)
  }

  const clearOrphans = async ({ keep }: { keep: readonly string[] }): Promise<void> => {
    const names = await fs.readdir(dir).catch((): readonly string[] => [])
    const orphans = names.filter((name) => {
      const id = serverIdOf(name)
      return id !== null && !keep.includes(id)
    })
    await Promise.all(
      orphans.map((name) =>
        fs.remove(join(dir, name)).catch(() => {
          warn(`raven player could not clear an old sign-in in ${ACCOUNTS_DIR}`)
        }),
      ),
    )
  }

  return { storageFor, isRemembered, forget, clearOrphans }
}
