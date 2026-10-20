import { describe, expect, it } from 'bun:test'
import { SESSION_STORAGE_KEY as KEY } from '@/main/accounts/accountSessions'
import {
  ACCOUNTS_DIR,
  createSessionStore,
  isForcedMemoryFrom,
  SAFE_STORAGE_HOOK,
  SAFE_STORAGE_OFF,
  type SafeStorage,
  type SessionFs,
} from '@/main/accounts/sessionStore'

const ID_A = '0f4e2a4c-1b8c-4f9e-9e21-6f1f0f1d2c3a'
const ID_B = '11111111-2222-4333-8444-555555555555'
const DIR = '/profile/accounts'
const FILE_A = `${DIR}/${ID_A}.bin`
const FILE_B = `${DIR}/${ID_B}.bin`
const SESSION = JSON.stringify({
  access_token: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJhIn0.c2ln',
  refresh_token: 'refresh-plaintext-123',
})
const MAGIC = 'sealed:'

const missing = (): Error => Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })

/** Scrambles each byte, so a plaintext never shows in what it returns. */
const fakeSafeStorage = ({ isAvailable = true }: { isAvailable?: boolean } = {}) => {
  const calls = { encrypt: 0, decrypt: 0 }
  const storage: SafeStorage = {
    isEncryptionAvailable: () => isAvailable,
    encryptString: (plainText) => {
      calls.encrypt += 1
      return Buffer.concat([
        Buffer.from(MAGIC),
        Buffer.from(Buffer.from(plainText).map((byte) => byte ^ 0x5a)),
      ])
    },
    decryptString: (encrypted) => {
      calls.decrypt += 1
      if (!encrypted.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.')
      }
      return Buffer.from(encrypted.subarray(MAGIC.length).map((byte) => byte ^ 0x5a)).toString()
    },
  }
  return { storage, calls }
}

type Entry = { data: Buffer; mode: number }

const fakeFs = () => {
  const files = new Map<string, Entry>()
  const dirs = new Map<string, number>()
  const reads: string[] = []
  const fs: SessionFs = {
    readFile: async (path) => {
      reads.push(path)
      const entry = files.get(path)
      if (entry === undefined) throw missing()
      return entry.data
    },
    writeFile: async ({ path, data, mode }) => {
      files.set(path, { data, mode })
    },
    rename: async ({ from, to }) => {
      const entry = files.get(from)
      if (entry === undefined) throw missing()
      files.delete(from)
      files.set(to, entry)
    },
    remove: async (path) => {
      files.delete(path)
    },
    mkdir: async ({ path, mode }) => {
      dirs.set(path, mode)
    },
    readdir: async (path) => {
      if (!dirs.has(path) && ![...files.keys()].some((file) => file.startsWith(`${path}/`))) {
        throw missing()
      }
      return [...files.keys()]
        .filter((file) => file.startsWith(`${path}/`))
        .map((file) => file.slice(path.length + 1))
    },
  }
  return { fs, files, dirs, reads }
}

const storeWith = ({
  fs,
  safeStorage = fakeSafeStorage().storage,
  isForcedMemory = false,
  warnings = [],
}: {
  fs: SessionFs
  safeStorage?: SafeStorage
  isForcedMemory?: boolean
  warnings?: string[]
}) =>
  createSessionStore({
    dir: DIR,
    safeStorage,
    isForcedMemory,
    fs,
    warn: (message) => {
      warnings.push(message)
    },
  })

describe('createSessionStore', () => {
  it('keeps the folder name the plan names', () => {
    expect(ACCOUNTS_DIR).toBe('accounts')
  })

  it('round trips a session through an encrypted file a new store reads back', async () => {
    const { fs, files, dirs } = fakeFs()
    const store = storeWith({ fs })
    await store.storageFor(ID_A).setItem(KEY, SESSION)
    expect(await store.storageFor(ID_A).getItem(KEY)).toBe(SESSION)
    expect([...files.keys()]).toEqual([FILE_A])
    expect(files.get(FILE_A)?.mode ?? null).toBe(0o600)
    expect(dirs.get(DIR)).toBe(0o700)

    const next = storeWith({ fs })
    expect(await next.storageFor(ID_A).getItem(KEY)).toBe(SESSION)
    expect(await next.storageFor(ID_B).getItem(KEY)).toBeNull()
    expect(next.isRemembered()).toBe(true)
  })

  it('never writes the session, its token or its refresh token in the clear', async () => {
    const { fs, files } = fakeFs()
    await storeWith({ fs }).storageFor(ID_A).setItem(KEY, SESSION)
    const onDisk = files.get(FILE_A)?.data.toString('latin1') ?? ''
    expect(onDisk).not.toContain('eyJ')
    expect(onDisk).not.toContain('refresh-plaintext-123')
    expect(onDisk).not.toContain(KEY)
  })

  it('writes through a temporary file it renames, so a crash never leaves half a blob', async () => {
    const { fs } = fakeFs()
    const written: string[] = []
    const watched: SessionFs = {
      ...fs,
      writeFile: async (input) => {
        written.push(input.path)
        await fs.writeFile(input)
      },
    }
    await storeWith({ fs: watched }).storageFor(ID_A).setItem(KEY, SESSION)
    expect(written).toEqual([`${FILE_A}.tmp`])
  })

  it('reads a server file once, on first use', async () => {
    const { fs, reads } = fakeFs()
    await storeWith({ fs }).storageFor(ID_A).setItem(KEY, SESSION)
    const store = storeWith({ fs })
    expect(reads).toEqual([FILE_A])
    await store.storageFor(ID_A).getItem(KEY)
    await store.storageFor(ID_A).getItem('other')
    await store.storageFor(ID_A).setItem('other', 'x')
    expect(reads).toEqual([FILE_A, FILE_A])
  })

  it('keeps every key of a server in its one file', async () => {
    const { fs } = fakeFs()
    const store = storeWith({ fs })
    const storage = store.storageFor(ID_A)
    await Promise.all([storage.setItem(KEY, SESSION), storage.setItem(`${KEY}-user`, 'user')])
    const next = storeWith({ fs }).storageFor(ID_A)
    expect(await next.getItem(KEY)).toBe(SESSION)
    expect(await next.getItem(`${KEY}-user`)).toBe('user')
  })

  it('removes the file once its last key goes', async () => {
    const { fs, files } = fakeFs()
    const storage = storeWith({ fs }).storageFor(ID_A)
    await storage.setItem(KEY, SESSION)
    await storage.removeItem(KEY)
    expect(await storage.getItem(KEY)).toBeNull()
    expect(files.size).toBe(0)
  })

  it('writes nothing when encryption is unavailable, holding the session in memory', async () => {
    const { fs, files, dirs } = fakeFs()
    const { storage: safeStorage, calls } = fakeSafeStorage({ isAvailable: false })
    const store = storeWith({ fs, safeStorage })
    expect(store.isRemembered()).toBe(false)
    await store.storageFor(ID_A).setItem(KEY, SESSION)
    expect(await store.storageFor(ID_A).getItem(KEY)).toBe(SESSION)
    expect(files.size).toBe(0)
    expect(dirs.size).toBe(0)
    expect(calls.encrypt).toBe(0)
    expect(await storeWith({ fs, safeStorage }).storageFor(ID_A).getItem(KEY)).toBeNull()
  })

  it('writes nothing when the test hook forces memory', async () => {
    const { fs, files } = fakeFs()
    const { storage: safeStorage, calls } = fakeSafeStorage()
    const store = storeWith({ fs, safeStorage, isForcedMemory: true })
    expect(store.isRemembered()).toBe(false)
    await store.storageFor(ID_A).setItem(KEY, SESSION)
    expect(await store.storageFor(ID_A).getItem(KEY)).toBe(SESSION)
    expect(files.size).toBe(0)
    expect(calls.encrypt).toBe(0)
  })

  it('removes a kept blob it cannot use when encryption has gone away', async () => {
    const { fs, files } = fakeFs()
    await storeWith({ fs }).storageFor(ID_A).setItem(KEY, SESSION)
    const unavailable = fakeSafeStorage({ isAvailable: false })
    const store = storeWith({ fs, safeStorage: unavailable.storage })
    expect(await store.storageFor(ID_A).getItem(KEY)).toBeNull()
    expect(files.size).toBe(0)
    expect(unavailable.calls.decrypt).toBe(0)
  })

  it('removes a blob that does not decrypt and reads it as empty, naming only the server', async () => {
    const { fs, files } = fakeFs()
    files.set(FILE_A, { data: Buffer.from('not sealed at all'), mode: 0o600 })
    const warnings: string[] = []
    const store = storeWith({ fs, warnings })
    expect(await store.storageFor(ID_A).getItem(KEY)).toBeNull()
    expect(files.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(ID_A)
    expect(warnings[0]).not.toContain('sealed')
    expect(warnings[0]).not.toContain('ciphertext')
  })

  it.each(['{not json', '[]', '{"key":1}', 'null'])(
    'removes a blob that decrypts to %s rather than a map of strings',
    async (blob) => {
      const { fs, files } = fakeFs()
      const { storage: safeStorage } = fakeSafeStorage()
      files.set(FILE_A, { data: safeStorage.encryptString(blob), mode: 0o600 })
      const store = storeWith({ fs, safeStorage })
      expect(await store.storageFor(ID_A).getItem(KEY)).toBeNull()
      expect(files.has(FILE_A)).toBe(false)
    },
  )

  it('reads a missing file as empty without a warning', async () => {
    const { fs } = fakeFs()
    const warnings: string[] = []
    expect(await storeWith({ fs, warnings }).storageFor(ID_A).getItem(KEY)).toBeNull()
    expect(warnings).toEqual([])
  })

  it('keeps the session in memory and warns when the write fails', async () => {
    const { fs } = fakeFs()
    const warnings: string[] = []
    const failing: SessionFs = {
      ...fs,
      writeFile: async () => {
        throw new Error(`disk full writing ${SESSION}`)
      },
    }
    const store = storeWith({ fs: failing, warnings })
    await store.storageFor(ID_A).setItem(KEY, SESSION)
    expect(await store.storageFor(ID_A).getItem(KEY)).toBe(SESSION)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(ID_A)
    expect(warnings[0]).not.toContain('refresh-plaintext-123')
  })

  it('forget removes the file and what it held in memory', async () => {
    const { fs, files } = fakeFs()
    const store = storeWith({ fs })
    await store.storageFor(ID_A).setItem(KEY, SESSION)
    await store.storageFor(ID_B).setItem(KEY, SESSION)
    await store.forget(ID_A)
    expect([...files.keys()]).toEqual([FILE_B])
    expect(await store.storageFor(ID_A).getItem(KEY)).toBeNull()
  })

  it('forget removes a file this run never read', async () => {
    const { fs, files } = fakeFs()
    await storeWith({ fs }).storageFor(ID_A).setItem(KEY, SESSION)
    await storeWith({ fs }).forget(ID_A)
    expect(files.size).toBe(0)
  })

  it('refuses an id that is not opaque, since it names a file', async () => {
    const { fs } = fakeFs()
    const store = storeWith({ fs })
    expect(() => store.storageFor('../escape')).toThrow()
    await expect(store.forget('../escape')).rejects.toThrow()
  })
})

describe('clearOrphans', () => {
  it('removes the files of servers the config no longer holds', async () => {
    const { fs, files } = fakeFs()
    const store = storeWith({ fs })
    await store.storageFor(ID_A).setItem(KEY, SESSION)
    await store.storageFor(ID_B).setItem(KEY, SESSION)
    await store.clearOrphans({ keep: [ID_B] })
    expect([...files.keys()]).toEqual([FILE_B])
  })

  it('ignores names that are not an opaque id', async () => {
    const { fs, files } = fakeFs()
    const others = [
      `${DIR}/notes.txt`,
      `${DIR}/not-an-id.bin`,
      `${DIR}/${ID_A}.bin.tmp`,
      `${DIR}/${ID_A.toUpperCase()}.bin`,
      `${DIR}/${ID_A}`,
    ]
    others.forEach((path) => files.set(path, { data: Buffer.from('x'), mode: 0o600 }))
    await storeWith({ fs }).clearOrphans({ keep: [] })
    expect([...files.keys()].toSorted()).toEqual(others.toSorted())
  })

  it('does nothing when the folder was never made', async () => {
    const { fs } = fakeFs()
    const warnings: string[] = []
    await storeWith({ fs, warnings }).clearOrphans({ keep: [] })
    expect(warnings).toEqual([])
  })
})

describe('isForcedMemoryFrom', () => {
  const env = (value: string | undefined) => ({ [SAFE_STORAGE_HOOK]: value })

  it('forces memory only unpackaged, and only for off', () => {
    expect(isForcedMemoryFrom({ isPackaged: false, env: env(SAFE_STORAGE_OFF) })).toBe(true)
    expect(isForcedMemoryFrom({ isPackaged: true, env: env(SAFE_STORAGE_OFF) })).toBe(false)
    expect(isForcedMemoryFrom({ isPackaged: false, env: env(undefined) })).toBe(false)
    expect(isForcedMemoryFrom({ isPackaged: false, env: env('on') })).toBe(false)
  })
})
