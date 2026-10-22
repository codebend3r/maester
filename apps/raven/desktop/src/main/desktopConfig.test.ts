import { describe, expect, it } from 'bun:test'
import { DEFAULT_OUTPUT_SETTINGS, type PassthroughFormat } from '@raven/core'
import {
  CONFIG_FILE,
  DEFAULT_UPDATE_SETTINGS,
  SERVER_NAME,
  isDesktopConfig,
  isStoredConfig,
  loadConfig,
  namesServer,
  pickOutput,
  serverById,
  serverOf,
  setLastAccount,
  setOutput,
  setUpdates,
  upgradeConfig,
} from '@/main/desktopConfig'
import { configFor } from '@/main/test/configFakes'
import type { StateFs } from '@/main/stateStore'

const idFor = ({ n }: { n: number }): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const ORIGIN = 'https://raven.example.ts.net'
const ALIAS = 'http://192.168.50.6:8484'
const SERVER = { origin: ORIGIN, aliases: [ALIAS] }
const NEW_ID = idFor({ n: 99 })
const newId = () => NEW_ID

/** A server as versions 2 to 4 kept it: more fields than version 5 reads. */
const listedFor = ({ n, origin }: { n: number; origin: string }) => ({
  id: idFor({ n }),
  origin,
  name: `Server ${n}`,
  addedAt: n,
})

const UPDATES = { isEnabled: false, checkedAt: 5 }

const CONFIG = configFor({ id: idFor({ n: 1 }), origin: ORIGIN })

const missing = ({ path }: { path: string }): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' })

const fakeFs = ({ initial }: { initial: Record<string, string> }) => {
  const files = new Map(Object.entries(initial))
  const fs: StateFs = {
    readFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) throw missing({ path })
      return text
    },
    writeFile: async ({ path, data }) => {
      files.set(path, data)
    },
    rename: async ({ from, to }) => {
      const text = files.get(from)
      if (text === undefined) throw missing({ path: from })
      files.delete(from)
      files.set(to, text)
    },
  }
  return { fs, files }
}

describe('isDesktopConfig', () => {
  it('is version 5 with one server and the release check', () => {
    expect(isDesktopConfig(CONFIG)).toBe(true)
  })

  it('rejects another version', () => {
    expect(isDesktopConfig({ ...CONFIG, version: 4 })).toBe(false)
    expect(isDesktopConfig({ ...CONFIG, version: 6 })).toBe(false)
  })

  it('rejects a config without output, a server or updates', () => {
    const { output, server, updates } = CONFIG
    expect(isDesktopConfig({ version: 5, server, updates })).toBe(false)
    expect(isDesktopConfig({ version: 5, output, updates })).toBe(false)
    expect(isDesktopConfig({ version: 5, output, server })).toBe(false)
  })

  it.each([
    ['an id that is not opaque', { id: '../x', origin: ORIGIN }],
    ['an origin with a path', { id: idFor({ n: 1 }), origin: `${ORIGIN}/path` }],
    ['an origin that is not canonical', { id: idFor({ n: 1 }), origin: `${ORIGIN}/` }],
  ])('rejects a server with %s', (_name, server) => {
    expect(isDesktopConfig({ ...CONFIG, server })).toBe(false)
  })

  it('rejects update settings that fail their guard', () => {
    expect(isDesktopConfig({ ...CONFIG, updates: { isEnabled: 'yes', checkedAt: null } })).toBe(
      false,
    )
  })
})

describe('isStoredConfig', () => {
  it.each([
    ['a version 1 file with only output', { version: 1, output: DEFAULT_OUTPUT_SETTINGS }],
    [
      'a version 2 file without update settings',
      { version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers: [] },
    ],
    [
      'a version 3 file',
      {
        version: 3,
        output: DEFAULT_OUTPUT_SETTINGS,
        servers: [listedFor({ n: 1, origin: ORIGIN })],
        updates: UPDATES,
      },
    ],
    [
      'a version 4 file whose server pinned a sign-in',
      {
        version: 4,
        output: DEFAULT_OUTPUT_SETTINGS,
        servers: [{ ...listedFor({ n: 1, origin: ORIGIN }), signIn: { webUrl: ORIGIN } }],
        updates: UPDATES,
      },
    ],
    ['a version 5 file', CONFIG],
  ])('accepts %s', (_name, stored) => {
    expect(isStoredConfig(stored)).toBe(true)
  })

  it('rejects an unknown version and a list holding a server with a bad id', () => {
    expect(isStoredConfig({ ...CONFIG, version: 6 })).toBe(false)
    expect(
      isStoredConfig({
        version: 4,
        output: DEFAULT_OUTPUT_SETTINGS,
        servers: [{ id: '../x', origin: ORIGIN }],
        updates: UPDATES,
      }),
    ).toBe(false)
  })
})

describe('namesServer', () => {
  it("is true for the server's origin and its aliases, and false for any other", () => {
    expect(namesServer({ server: SERVER, origin: ORIGIN })).toBe(true)
    expect(namesServer({ server: SERVER, origin: ALIAS })).toBe(true)
    expect(namesServer({ server: SERVER, origin: 'https://other.example' })).toBe(false)
  })
})

describe('upgradeConfig', () => {
  const v4 = (servers: readonly ReturnType<typeof listedFor>[]) => ({
    version: 4 as const,
    output: DEFAULT_OUTPUT_SETTINGS,
    servers: [...servers],
    updates: UPDATES,
  })

  it('gives a version 1 config the server with a new id and the release check on', () => {
    const output = { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' as const }
    expect(upgradeConfig({ stored: { version: 1, output }, server: SERVER, newId })).toEqual({
      config: {
        version: 5,
        output,
        server: { id: NEW_ID, origin: ORIGIN },
        updates: DEFAULT_UPDATE_SETTINGS,
        lastAccountId: null,
      },
      adopted: [],
      isChanged: true,
    })
  })

  it('keeps the id of the first listed server that names the server, by its origin or an alias', () => {
    const stored = v4([
      listedFor({ n: 1, origin: 'https://other.example' }),
      listedFor({ n: 2, origin: ALIAS }),
      listedFor({ n: 3, origin: ORIGIN }),
    ])
    expect(upgradeConfig({ stored, server: SERVER, newId })).toEqual({
      config: {
        version: 5,
        output: DEFAULT_OUTPUT_SETTINGS,
        server: { id: idFor({ n: 2 }), origin: ORIGIN },
        updates: UPDATES,
        lastAccountId: null,
      },
      adopted: [idFor({ n: 3 })],
      isChanged: true,
    })
  })

  it('gives the server a new id when no listed server names it', () => {
    const stored = v4([listedFor({ n: 1, origin: 'https://other.example' })])
    expect(upgradeConfig({ stored, server: SERVER, newId })).toEqual({
      config: { ...configFor({ id: NEW_ID, origin: ORIGIN }), updates: UPDATES },
      adopted: [],
      isChanged: true,
    })
  })

  it('reads a version 2 list with the release check on, and a version 3 one with its settings', () => {
    const servers = [listedFor({ n: 1, origin: ORIGIN })]
    const fromTwo = upgradeConfig({
      stored: { version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers },
      server: SERVER,
      newId,
    })
    const fromThree = upgradeConfig({
      stored: { version: 3, output: DEFAULT_OUTPUT_SETTINGS, servers, updates: UPDATES },
      server: SERVER,
      newId,
    })
    expect(fromTwo.config.server.id).toBe(idFor({ n: 1 }))
    expect(fromTwo.config.updates).toEqual(DEFAULT_UPDATE_SETTINGS)
    expect(fromThree.config.updates).toEqual(UPDATES)
  })

  it('keeps a version 5 server whose origin the build still names, under that origin now', () => {
    const stored = configFor({ id: idFor({ n: 1 }), origin: ALIAS })
    expect(upgradeConfig({ stored, server: SERVER, newId })).toEqual({
      config: configFor({ id: idFor({ n: 1 }), origin: ORIGIN }),
      adopted: [],
      isChanged: true,
    })
  })

  it('keeps the last account of the server', () => {
    const kept = { ...configFor({ id: idFor({ n: 1 }), origin: ORIGIN }), lastAccountId: 'ada' }
    expect(upgradeConfig({ stored: kept, server: SERVER, newId }).config.lastAccountId).toBe('ada')
    expect(isDesktopConfig({ ...kept, lastAccountId: 7 })).toBe(false)
  })

  it('sets the last account, keeping the rest', () => {
    expect(setLastAccount({ config: CONFIG, accountId: 'bea' })).toEqual({
      ...CONFIG,
      lastAccountId: 'bea',
    })
  })

  it('moves a version 5 server the build no longer names to its origin, keeping its id and account', () => {
    const stored = {
      ...configFor({ id: idFor({ n: 1 }), origin: 'https://other.example' }),
      lastAccountId: 'ada',
    }
    expect(upgradeConfig({ stored, server: SERVER, newId })).toEqual({
      config: { ...configFor({ id: idFor({ n: 1 }), origin: ORIGIN }), lastAccountId: 'ada' },
      adopted: [],
      isChanged: true,
    })
  })

  it('rebuilds the output and the update settings from their own fields', () => {
    const stored = {
      ...CONFIG,
      output: { ...DEFAULT_OUTPUT_SETTINGS, extra: 'x' },
      updates: { ...UPDATES, url: 'https://evil.example/' },
    }
    const { config } = upgradeConfig({ stored, server: SERVER, newId })
    expect(Object.keys(config.output).length).toBe(4)
    expect(config.updates).toEqual(UPDATES)
  })

  it('gives every upgraded config its own update settings', () => {
    const { config } = upgradeConfig({
      stored: { version: 1, output: DEFAULT_OUTPUT_SETTINGS },
      server: SERVER,
      newId,
    })
    expect(config.updates).not.toBe(DEFAULT_UPDATE_SETTINGS)
  })

  it('does not mutate its input', () => {
    const stored = v4([listedFor({ n: 1, origin: ORIGIN }), listedFor({ n: 2, origin: ALIAS })])
    const before = structuredClone(stored)
    upgradeConfig({ stored, server: SERVER, newId })
    expect(stored).toEqual(before)
  })
})

describe('serverOf and serverById', () => {
  it('names the server raven, and finds it by its id alone', () => {
    const server = { id: idFor({ n: 1 }), origin: ORIGIN, name: SERVER_NAME }
    expect(SERVER_NAME).toBe('raven')
    expect(serverOf(CONFIG)).toEqual(server)
    expect(serverById({ config: CONFIG, serverId: idFor({ n: 1 }) })).toEqual(server)
    expect(serverById({ config: CONFIG, serverId: idFor({ n: 2 }) })).toBeNull()
  })
})

describe('loadConfig', () => {
  const FILE = `/data/${CONFIG_FILE}`
  const now = () => 1700000000000
  const load = ({ fs }: { fs: StateFs }) =>
    loadConfig({ fs, file: FILE, now, server: SERVER, newId })

  it('reads a version 4 file, adopting a second server that names the same one', async () => {
    const written = {
      version: 4,
      output: DEFAULT_OUTPUT_SETTINGS,
      servers: [listedFor({ n: 1, origin: ORIGIN }), listedFor({ n: 2, origin: ALIAS })],
      updates: UPDATES,
    }
    const { fs } = fakeFs({ initial: { [FILE]: JSON.stringify(written) } })
    expect(await load({ fs })).toEqual({
      config: { ...configFor({ id: idFor({ n: 1 }), origin: ORIGIN }), updates: UPDATES },
      adopted: [idFor({ n: 2 })],
      isChanged: true,
    })
  })

  it('reads a version 5 file as it is', async () => {
    const { fs } = fakeFs({ initial: { [FILE]: JSON.stringify(CONFIG) } })
    expect(await load({ fs })).toEqual({ config: CONFIG, adopted: [], isChanged: false })
  })

  it('starts with the server under a new id when there is no file', async () => {
    const { fs } = fakeFs({ initial: {} })
    expect(await load({ fs })).toEqual({
      config: configFor({ id: NEW_ID, origin: ORIGIN }),
      adopted: [],
      isChanged: true,
    })
  })

  it('renames a truncated file aside and starts afresh', async () => {
    const { fs, files } = fakeFs({ initial: { [FILE]: '{"version":5,"output":' } })
    expect((await load({ fs })).config).toEqual(configFor({ id: NEW_ID, origin: ORIGIN }))
    expect(files.has(FILE)).toBe(false)
    expect(files.get(`${FILE}.corrupt-1700000000000`)).toBe('{"version":5,"output":')
  })

  it('renames a file from a later version aside', async () => {
    const text = JSON.stringify({ ...CONFIG, version: 6 })
    const { fs, files } = fakeFs({ initial: { [FILE]: text } })
    expect((await load({ fs })).config.server.id).toBe(NEW_ID)
    expect(files.get(`${FILE}.corrupt-1700000000000`)).toBe(text)
  })
})

describe('CONFIG_FILE', () => {
  it('names the file in the user data directory', () => {
    expect(CONFIG_FILE).toBe('desktop-config.json')
  })
})

describe('setOutput', () => {
  it('returns a new config and leaves its input untouched', () => {
    const before = structuredClone(CONFIG)
    const output = { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' as const }
    const next = setOutput({ config: CONFIG, output })
    expect(next).not.toBe(CONFIG)
    expect(next.output).toEqual(output)
    expect(CONFIG).toEqual(before)
  })
})

describe('setUpdates', () => {
  it('returns a new config and leaves its input untouched', () => {
    const before = structuredClone(CONFIG)
    const updates = { isEnabled: false, checkedAt: 7 }
    const next = setUpdates({ config: CONFIG, updates })
    expect(next).not.toBe(CONFIG)
    expect(next).toEqual({ ...CONFIG, updates })
    expect(CONFIG).toEqual(before)
  })
})

describe('pickOutput', () => {
  it('rebuilds the four known fields, deduplicated and in format order', () => {
    const passthrough: PassthroughFormat[] = ['dts', 'ac3', 'dts']
    const dirty = { ...DEFAULT_OUTPUT_SETTINGS, passthrough, extra: 'x' }
    const picked = pickOutput(dirty)
    expect(picked).toEqual({
      profile: 'pcm',
      device: 'auto',
      passthrough: ['ac3', 'dts'],
      spatial: false,
    })
    expect(Object.keys(picked).length).toBe(4)
  })
})
