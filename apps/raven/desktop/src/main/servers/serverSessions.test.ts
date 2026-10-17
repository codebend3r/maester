import { describe, expect, it } from 'bun:test'
import {
  clearOrphanPartitions,
  createServerSessions,
  FORGET_TIMEOUT_MS,
  ORPHAN_LIST_MS,
  orphanPartitions,
  partitionFor,
  type ServerSession,
} from '@/main/servers/serverSessions'
import { fakeTimers } from '@/main/test/playerFakes'

const ID_A = '0f4e2a4c-1b8c-4f9e-9e21-6f1f0f1d2c3a'
const ID_B = '11111111-2222-4333-8444-555555555555'
const ORIGIN = 'http://127.0.0.1:4100'

type Permission = { isGranted: boolean | null; isChecked: boolean | null }

/** A session that records what reaches it; `clear` decides how its clears end. */
const fakeSession = ({
  log,
  clear = async () => {},
}: {
  log: string[]
  clear?: () => Promise<void>
}) => {
  const permission: Permission = { isGranted: null, isChecked: null }
  const fetched: { url: string; init: RequestInit }[] = []
  const cookieFilters: unknown[] = []
  const session: ServerSession = {
    fetch: async (url, init) => {
      fetched.push({ url, init })
      return new Response('{"available":true,"unlocked":false}', { status: 200 })
    },
    cookies: {
      get: async (filter) => {
        cookieFilters.push(filter)
        return [
          { name: 'raven_unlock', value: 'a.b', domain: '127.0.0.1', path: '/api' },
          { name: 'raven_admin', value: 'c.d', domain: '127.0.0.1', path: '/api' },
        ]
      },
    },
    clearStorageData: async () => {
      log.push('clearStorageData')
      await clear()
    },
    clearCache: async () => {
      log.push('clearCache')
      await clear()
    },
    setPermissionRequestHandler: (handler) => {
      handler(null, 'media', (isGranted) => {
        permission.isGranted = isGranted
      })
    },
    setPermissionCheckHandler: (handler) => {
      permission.isChecked = handler(null, 'media')
    },
  }
  return { session, permission, fetched, cookieFilters }
}

const sessionsWith = ({ clear }: { clear?: () => Promise<void> } = {}) => {
  const log: string[] = []
  const made = new Map<string, ReturnType<typeof fakeSession>>()
  const warnings: string[] = []
  const clock = fakeTimers()
  const sessions = createServerSessions({
    fromPartition: (partition) => {
      log.push(`fromPartition ${partition}`)
      const existing = made.get(partition)
      if (existing !== undefined) return existing.session
      const fake = fakeSession({ log, clear })
      made.set(partition, fake)
      return fake.session
    },
    timers: clock.timers,
    warn: (message) => {
      warnings.push(message)
    },
  })
  const fakeOf = (serverId: string) => {
    const fake = made.get(partitionFor({ serverId }))
    if (fake === undefined) throw new Error(`no session for ${serverId}`)
    return fake
  }
  return { sessions, log, fakeOf, warnings, clock }
}

describe('partitionFor', () => {
  it('names a persistent partition per server', () => {
    expect(partitionFor({ serverId: ID_A })).toBe(`persist:server:${ID_A}`)
  })
})

describe('createServerSessions', () => {
  it('makes no session until a server is used', () => {
    const { log } = sessionsWith()
    expect(log).toEqual([])
  })

  it('makes one session per server, once, denying every permission', () => {
    const { sessions, log, fakeOf } = sessionsWith()
    sessions.sessionOf(ID_A)
    sessions.sessionOf(ID_A)
    sessions.sessionOf(ID_B)
    expect(log).toEqual([
      `fromPartition persist:server:${ID_A}`,
      `fromPartition persist:server:${ID_B}`,
    ])
    expect(fakeOf(ID_A).permission).toEqual({ isGranted: false, isChecked: false })
  })

  it('refuses an id that is not opaque, so no partition is named after it', () => {
    const { sessions, log } = sessionsWith()
    expect(() => sessions.sessionOf('../default')).toThrow()
    expect(log).toEqual([])
  })

  it("fetches through the server's own session with its cookies and no redirects", async () => {
    const { sessions, fakeOf } = sessionsWith()
    const reply = await sessions.fetchFor(ID_A)({
      url: `${ORIGIN}/api/lock`,
      method: 'GET',
      headers: { accept: 'application/json' },
      body: null,
      timeoutMs: 1000,
    })
    expect(reply.status).toBe(200)
    const [sent] = fakeOf(ID_A).fetched
    expect(sent?.url ?? null).toBe(`${ORIGIN}/api/lock`)
    expect(sent?.init.credentials ?? null).toBe('include')
    expect(sent?.init.redirect ?? null).toBe('error')
  })

  it('a bad id fails the fetch rather than throwing out of it', async () => {
    const { sessions } = sessionsWith()
    const fetch = sessions.fetchFor('not-an-id')
    const reply = fetch({
      url: `${ORIGIN}/api/lock`,
      method: 'GET',
      headers: {},
      body: null,
      timeoutMs: 1000,
    })
    await expect(reply).rejects.toThrow()
  })

  it("reads cookies for the file's URL from that server's session, names and values only", async () => {
    const { sessions, fakeOf } = sessionsWith()
    const url = `${ORIGIN}/api/media/7/file`
    const cookies = await sessions.cookiesFor({ serverId: ID_A, url })
    expect(fakeOf(ID_A).cookieFilters).toEqual([{ url }])
    expect(cookies).toEqual([
      { name: 'raven_unlock', value: 'a.b' },
      { name: 'raven_admin', value: 'c.d' },
    ])
  })

  it('forget clears the storage and the cache, and the next use asks for the session again', async () => {
    const { sessions, log } = sessionsWith()
    sessions.sessionOf(ID_A)
    await sessions.forget(ID_A)
    expect(log.slice(1).toSorted()).toEqual(['clearCache', 'clearStorageData'])
    sessions.sessionOf(ID_A)
    expect(log.filter((line) => line.startsWith('fromPartition'))).toHaveLength(2)
  })

  it('forget clears a server this run never used, since its session is on disk', async () => {
    const { sessions, log } = sessionsWith()
    await sessions.forget(ID_B)
    expect(log[0]).toBe(`fromPartition persist:server:${ID_B}`)
    expect(log.slice(1).toSorted()).toEqual(['clearCache', 'clearStorageData'])
  })

  it('forget leaves no timer behind once the clears finish', async () => {
    const { sessions, clock } = sessionsWith()
    await sessions.forget(ID_A)
    expect(clock.pending.size).toBe(0)
  })

  it('a clear that never finishes is given up on after FORGET_TIMEOUT_MS, with a warning', async () => {
    const { sessions, clock, warnings } = sessionsWith({ clear: () => new Promise(() => {}) })
    const forgetting = sessions.forget(ID_A)
    await Promise.resolve()
    expect([...clock.pending.values()].map(({ ms }) => ms)).toEqual([FORGET_TIMEOUT_MS])
    clock.fire()
    await forgetting
    expect(warnings).toHaveLength(1)
    expect(warnings[0] ?? '').toContain(ID_A)
  })

  it('a clear that fails rejects, for the caller to log', async () => {
    const { sessions, clock } = sessionsWith({
      clear: () => Promise.reject(new Error('locked')),
    })
    await expect(sessions.forget(ID_A)).rejects.toThrow('locked')
    await Promise.resolve()
    expect(clock.pending.size).toBe(0)
  })
})

describe('orphanPartitions', () => {
  it('names the server partitions on disk that the config does not hold', () => {
    expect(
      orphanPartitions({
        names: [`server%3A${ID_A}`, `server%3A${ID_B}`],
        keep: [ID_A],
      }),
    ).toEqual([`server%3A${ID_B}`])
  })

  it('never names anything that is not one of our server partitions', () => {
    expect(
      orphanPartitions({
        names: [
          'local',
          'server%3Anot-an-id',
          `server%3A${ID_A.toUpperCase()}`,
          `server%3A${ID_B}%2F..`,
          `remote%3A${ID_B}`,
          `server:${ID_B}`,
          `server%3A${ID_B}x`,
          '..',
        ],
        keep: [],
      }),
    ).toEqual([])
  })
})

describe('clearOrphanPartitions', () => {
  const DIR = '/data/Partitions'

  /** Lists the partitions and waits for the removals it started. */
  const cleared = async (input: Omit<Parameters<typeof clearOrphanPartitions>[0], 'timers'>) => {
    const { removing } = await clearOrphanPartitions({ ...input, timers: fakeTimers().timers })
    await removing
  }

  it('removes only the orphans, inside the partitions folder', async () => {
    const removed: string[] = []
    await cleared({
      dir: DIR,
      keep: [ID_A],
      fs: {
        readdir: async () => [`server%3A${ID_A}`, `server%3A${ID_B}`, 'other'],
        remove: async (path) => {
          removed.push(path)
        },
      },
      warn: () => {},
    })
    expect(removed).toEqual([`${DIR}/server%3A${ID_B}`])
  })

  it('a missing partitions folder is nothing to clear', async () => {
    const warnings: string[] = []
    await cleared({
      dir: DIR,
      keep: [],
      fs: {
        readdir: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        remove: async () => {},
      },
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(warnings).toEqual([])
  })

  it('warns, and goes on, when a folder cannot be read or removed', async () => {
    const warnings: string[] = []
    const removed: string[] = []
    const ID_C = '22222222-3333-4444-8555-666666666666'
    await cleared({
      dir: DIR,
      keep: [],
      fs: {
        readdir: async () => [`server%3A${ID_B}`, `server%3A${ID_C}`],
        remove: async (path) => {
          if (path.endsWith(ID_B)) throw new Error('busy')
          removed.push(path)
        },
      },
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(removed).toEqual([`${DIR}/server%3A${ID_C}`])
    expect(warnings).toHaveLength(1)
    const unreadable: string[] = []
    await cleared({
      dir: DIR,
      keep: [],
      fs: { readdir: () => Promise.reject(new Error('denied')), remove: async () => {} },
      warn: (message) => {
        unreadable.push(message)
      },
    })
    expect(unreadable).toHaveLength(1)
  })

  it('answers once the folder is listed, without waiting for the removals', async () => {
    const started: string[] = []
    const { removing } = await clearOrphanPartitions({
      dir: DIR,
      keep: [],
      fs: {
        readdir: async () => [`server%3A${ID_B}`],
        remove: (path) => {
          started.push(path)
          return new Promise<void>(() => undefined)
        },
      },
      timers: fakeTimers().timers,
      warn: () => {},
    })
    expect(started).toEqual([`${DIR}/server%3A${ID_B}`])
    expect(removing).toBeInstanceOf(Promise)
  })

  it('goes on with nothing to remove when the listing outlasts its budget', async () => {
    const clock = fakeTimers()
    const warnings: string[] = []
    const removed: string[] = []
    const listed: ((names: string[]) => void)[] = []
    const pending = clearOrphanPartitions({
      dir: DIR,
      keep: [],
      fs: {
        readdir: () =>
          new Promise<string[]>((resolve) => {
            listed.push(resolve)
          }),
        remove: async (path) => {
          removed.push(path)
        },
      },
      timers: clock.timers,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect([...clock.pending.values()].map(({ ms }) => ms)).toEqual([ORPHAN_LIST_MS])
    clock.fire()
    await (
      await pending
    ).removing
    listed.forEach((resolve) => resolve([`server%3A${ID_B}`]))
    await Promise.resolve()
    expect(removed).toEqual([])
    expect(warnings).toEqual([
      `raven player did not list its server sessions within ${ORPHAN_LIST_MS} ms, so it clears none this time`,
    ])
  })
})
