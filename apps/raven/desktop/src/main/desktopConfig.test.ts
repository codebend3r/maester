import { describe, expect, it } from 'bun:test'
import { DEFAULT_OUTPUT_SETTINGS, type PassthroughFormat } from '@raven/core'
import {
  CONFIG_FILE,
  DEFAULT_UPDATE_SETTINGS,
  EMPTY_CONFIG,
  isDesktopConfig,
  isServerEntry,
  isStoredConfig,
  loadConfig,
  pickOutput,
  setOutput,
  setUpdates,
  upgradeConfig,
  type ServerEntry,
} from '@/main/desktopConfig'
import type { StateFs } from '@/main/stateStore'

const idFor = ({ n }: { n: number }): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const entryFor = ({ n }: { n: number }): ServerEntry => ({
  id: idFor({ n }),
  origin: `https://s${n}.example`,
  name: `Server ${n}`,
  addedAt: n,
})

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
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    rename: async (from, to) => {
      const text = files.get(from)
      if (text === undefined) throw missing({ path: from })
      files.delete(from)
      files.set(to, text)
    },
  }
  return { fs, files }
}

describe('isDesktopConfig', () => {
  it('accepts the empty config', () => {
    expect(isDesktopConfig(EMPTY_CONFIG)).toBe(true)
  })

  it('is version 3 with no servers and the release check on', () => {
    expect(EMPTY_CONFIG).toEqual({
      version: 3,
      output: DEFAULT_OUTPUT_SETTINGS,
      servers: [],
      updates: { isEnabled: true, checkedAt: null },
    })
  })

  it('rejects another version', () => {
    expect(isDesktopConfig({ ...EMPTY_CONFIG, version: 2 })).toBe(false)
    expect(isDesktopConfig({ ...EMPTY_CONFIG, version: 4 })).toBe(false)
  })

  it('rejects a config without output, servers or updates', () => {
    const { output, servers, updates } = EMPTY_CONFIG
    expect(isDesktopConfig({ version: 3, servers, updates })).toBe(false)
    expect(isDesktopConfig({ version: 3, output, updates })).toBe(false)
    expect(isDesktopConfig({ version: 3, output, servers })).toBe(false)
  })

  it('rejects update settings that fail their guard', () => {
    expect(
      isDesktopConfig({ ...EMPTY_CONFIG, updates: { isEnabled: 'yes', checkedAt: null } }),
    ).toBe(false)
    expect(
      isDesktopConfig({ ...EMPTY_CONFIG, updates: { isEnabled: true, checkedAt: 'now' } }),
    ).toBe(false)
  })

  it('rejects a server that fails the entry guard', () => {
    expect(
      isDesktopConfig({ ...EMPTY_CONFIG, servers: [{ ...entryFor({ n: 1 }), id: '../x' }] }),
    ).toBe(false)
  })
})

describe('isServerEntry', () => {
  it('accepts an entry', () => {
    expect(isServerEntry(entryFor({ n: 1 }))).toBe(true)
  })

  it('rejects an origin with a path', () => {
    expect(isServerEntry({ ...entryFor({ n: 1 }), origin: 'https://x/path' })).toBe(false)
  })

  it('rejects an origin that is not canonical', () => {
    expect(isServerEntry({ ...entryFor({ n: 1 }), origin: 'https://S1.example:443' })).toBe(false)
    expect(isServerEntry({ ...entryFor({ n: 1 }), origin: 'https://s1.example/' })).toBe(false)
  })

  it('rejects an id that is not opaque', () => {
    expect(isServerEntry({ ...entryFor({ n: 1 }), id: '../x' })).toBe(false)
  })

  it('rejects a missing name or time', () => {
    expect(isServerEntry({ ...entryFor({ n: 1 }), name: undefined })).toBe(false)
    expect(isServerEntry({ ...entryFor({ n: 1 }), addedAt: 'now' })).toBe(false)
  })
})

describe('isStoredConfig', () => {
  it('accepts a version 1 file with only output', () => {
    expect(isStoredConfig({ version: 1, output: DEFAULT_OUTPUT_SETTINGS })).toBe(true)
  })

  it('accepts a version 2 file without update settings', () => {
    expect(isStoredConfig({ version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers: [] })).toBe(true)
  })

  it('accepts a version 3 file', () => {
    expect(isStoredConfig(EMPTY_CONFIG)).toBe(true)
  })

  it('rejects an unknown version', () => {
    expect(isStoredConfig({ ...EMPTY_CONFIG, version: 4 })).toBe(false)
  })
})

describe('upgradeConfig', () => {
  it('turns version 1 into version 3 with no servers and the release check on', () => {
    const output = { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' as const }
    expect(upgradeConfig({ version: 1, output })).toEqual({
      version: 3,
      output,
      servers: [],
      updates: { isEnabled: true, checkedAt: null },
    })
  })

  it('turns version 2 into version 3 with its servers and the release check on', () => {
    const servers = [entryFor({ n: 1 })]
    expect(upgradeConfig({ version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers })).toEqual({
      version: 3,
      output: DEFAULT_OUTPUT_SETTINGS,
      servers,
      updates: { isEnabled: true, checkedAt: null },
    })
  })

  it('rebuilds the version 1 output from its four fields', () => {
    const dirty = { ...DEFAULT_OUTPUT_SETTINGS, extra: 'x' }
    const upgraded = upgradeConfig({ version: 1, output: dirty })
    expect(Object.keys(upgraded.output).length).toBe(4)
  })

  it('keeps a version 3 config as it is', () => {
    const config = {
      ...EMPTY_CONFIG,
      servers: [entryFor({ n: 1 }), entryFor({ n: 2 })],
      updates: { isEnabled: false, checkedAt: 5 },
    }
    expect(upgradeConfig(config)).toEqual(config)
  })

  it('gives every upgraded config its own update settings', () => {
    const fromOne = upgradeConfig({ version: 1, output: DEFAULT_OUTPUT_SETTINGS })
    const fromTwo = upgradeConfig({ version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers: [] })
    const shared = [DEFAULT_UPDATE_SETTINGS, EMPTY_CONFIG.updates, fromOne.updates, fromTwo.updates]
    expect(new Set(shared).size).toBe(shared.length)
    expect(fromOne.updates).toEqual(DEFAULT_UPDATE_SETTINGS)
    expect(fromTwo.updates).toEqual(DEFAULT_UPDATE_SETTINGS)
  })

  it('rebuilds the version 3 update settings from their two fields', () => {
    const updates = { isEnabled: false, checkedAt: 5, url: 'https://evil.example/' }
    expect(upgradeConfig({ ...EMPTY_CONFIG, updates }).updates).toEqual({
      isEnabled: false,
      checkedAt: 5,
    })
  })

  it('keeps the first twenty servers whose id and origin were not seen before, in order', () => {
    const servers = [
      ...Array.from({ length: 20 }, (_, n) => entryFor({ n })),
      { ...entryFor({ n: 20 }), origin: entryFor({ n: 3 }).origin },
      { ...entryFor({ n: 21 }), id: entryFor({ n: 5 }).id },
    ]
    const upgraded = upgradeConfig({ ...EMPTY_CONFIG, servers })
    expect(servers.length).toBe(22)
    expect(upgraded.servers).toEqual(servers.slice(0, 20))
  })

  it('does not count a dropped duplicate against the cap', () => {
    const servers = [
      entryFor({ n: 0 }),
      { ...entryFor({ n: 99 }), origin: entryFor({ n: 0 }).origin },
      ...Array.from({ length: 19 }, (_, n) => entryFor({ n: n + 1 })),
    ]
    const upgraded = upgradeConfig({ ...EMPTY_CONFIG, servers })
    expect(upgraded.servers.length).toBe(20)
    expect(upgraded.servers.at(-1)).toEqual(entryFor({ n: 19 }))
  })

  it('drops the entries past the twentieth', () => {
    const servers = Array.from({ length: 25 }, (_, n) => entryFor({ n }))
    expect(upgradeConfig({ ...EMPTY_CONFIG, servers }).servers).toEqual(servers.slice(0, 20))
  })

  it('rebuilds each entry from its four fields', () => {
    const stray = { ...entryFor({ n: 1 }), token: 'secret' }
    const upgraded = upgradeConfig({ ...EMPTY_CONFIG, servers: [stray] })
    expect(upgraded.servers.map((server) => Object.keys(server).toSorted())).toEqual([
      ['addedAt', 'id', 'name', 'origin'],
    ])
  })

  it.each([
    ['a bidi override', 'Vha\u202egar', 'Vhagar'],
    ['a zero width', 'Vha\u200bgar', 'Vhagar'],
    ['a control character', 'Vha\u0007gar', 'Vhagar'],
    ['runs of whitespace', '  Vhagar \t NAS ', 'Vhagar NAS'],
    ['a name past 80 characters', 'a'.repeat(81), 'a'.repeat(80)],
    ['80 astral characters', '\u{1F985}'.repeat(80), '\u{1F985}'.repeat(80)],
    ['a joined emoji', '\u{1F468}\u200d\u{1F469} Home', '\u{1F468}\u200d\u{1F469} Home'],
    ['a name of nothing but hidden characters', '\u202e\u200b', 's1.example'],
    ['an empty name', '', 's1.example'],
  ])('cleans a stored name with %s', (_, name, cleaned) => {
    const upgraded = upgradeConfig({ ...EMPTY_CONFIG, servers: [{ ...entryFor({ n: 1 }), name }] })
    expect(upgraded.servers.map((server) => server.name)).toEqual([cleaned])
  })

  it('does not mutate its input', () => {
    const stored = { ...EMPTY_CONFIG, servers: [entryFor({ n: 1 }), entryFor({ n: 1 })] }
    const before = structuredClone(stored)
    upgradeConfig(stored)
    expect(stored).toEqual(before)
  })
})

describe('loadConfig', () => {
  const FILE = `/data/${CONFIG_FILE}`
  const now = () => 1700000000000
  const load = ({ fs }: { fs: StateFs }) => loadConfig({ fs, file: FILE, now })

  it('reads a version 1 file as version 3 with no servers', async () => {
    const output = { ...DEFAULT_OUTPUT_SETTINGS, spatial: true }
    const { fs, files } = fakeFs({ initial: { [FILE]: JSON.stringify({ version: 1, output }) } })
    expect(await load({ fs })).toEqual({ ...EMPTY_CONFIG, output })
    expect([...files.keys()]).toEqual([FILE])
  })

  it('reads a version 2 file as version 3 with its servers', async () => {
    const servers = [entryFor({ n: 1 })]
    const written = { version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers }
    const { fs } = fakeFs({ initial: { [FILE]: JSON.stringify(written) } })
    expect(await load({ fs })).toEqual({ ...EMPTY_CONFIG, servers })
  })

  it('reads a version 3 file with its update settings', async () => {
    const written = {
      ...EMPTY_CONFIG,
      servers: [entryFor({ n: 1 })],
      updates: { isEnabled: false, checkedAt: 5 },
    }
    const { fs } = fakeFs({ initial: { [FILE]: JSON.stringify(written) } })
    expect(await load({ fs })).toEqual(written)
  })

  it('starts empty when there is no file', async () => {
    const { fs } = fakeFs({ initial: {} })
    expect(await load({ fs })).toEqual(EMPTY_CONFIG)
  })

  it('renames a truncated file aside and starts empty', async () => {
    const { fs, files } = fakeFs({ initial: { [FILE]: '{"version":2,"output":' } })
    expect(await load({ fs })).toEqual(EMPTY_CONFIG)
    expect(files.has(FILE)).toBe(false)
    expect(files.get(`${FILE}.corrupt-1700000000000`)).toBe('{"version":2,"output":')
  })

  it('renames a file from a later version aside and starts empty', async () => {
    const text = JSON.stringify({ ...EMPTY_CONFIG, version: 4 })
    const { fs, files } = fakeFs({ initial: { [FILE]: text } })
    expect(await load({ fs })).toEqual(EMPTY_CONFIG)
    expect(files.has(FILE)).toBe(false)
    expect(files.get(`${FILE}.corrupt-1700000000000`)).toBe(text)
  })

  it('renames a file with a server that fails its guard aside', async () => {
    const text = JSON.stringify({
      ...EMPTY_CONFIG,
      servers: [{ ...entryFor({ n: 1 }), origin: 'https://x/path' }],
    })
    const { fs, files } = fakeFs({ initial: { [FILE]: text } })
    expect(await load({ fs })).toEqual(EMPTY_CONFIG)
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
    const before = structuredClone(EMPTY_CONFIG)
    const output = { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' as const }
    const next = setOutput({ config: EMPTY_CONFIG, output })
    expect(next).not.toBe(EMPTY_CONFIG)
    expect(next.output).toEqual(output)
    expect(EMPTY_CONFIG).toEqual(before)
  })
})

describe('setUpdates', () => {
  it('returns a new config and leaves its input untouched', () => {
    const before = structuredClone(EMPTY_CONFIG)
    const updates = { isEnabled: false, checkedAt: 7 }
    const next = setUpdates({ config: EMPTY_CONFIG, updates })
    expect(next).not.toBe(EMPTY_CONFIG)
    expect(next).toEqual({ ...EMPTY_CONFIG, updates })
    expect(EMPTY_CONFIG).toEqual(before)
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
