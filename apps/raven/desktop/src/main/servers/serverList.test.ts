import { describe, expect, it } from 'bun:test'
import {
  EMPTY_CONFIG,
  SERVERS_CAP as CONFIG_SERVERS_CAP,
  type DesktopConfig,
  type ServerEntry,
} from '@/main/desktopConfig'
import {
  NAME_MAX,
  SERVERS_CAP,
  addServer,
  cleanName,
  nameFor,
  removeServer,
  renameServer,
  serverById,
  serverByOrigin,
} from '@/main/servers/serverList'

const idFor = ({ n }: { n: number }): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const originFor = ({ n }: { n: number }): string => `https://s${n}.example`

const entryFor = ({ n }: { n: number }): ServerEntry => ({
  id: idFor({ n }),
  origin: originFor({ n }),
  name: `Server ${n}`,
  addedAt: n,
})

const configOf = ({ count }: { count: number }): DesktopConfig => ({
  ...EMPTY_CONFIG,
  servers: Array.from({ length: count }, (_, n) => entryFor({ n })),
})

describe('cleanName', () => {
  it('trims and collapses inner whitespace to one space', () => {
    expect(cleanName('  Vhagar   NAS ')).toBe('Vhagar NAS')
  })

  it('collapses tabs and line breaks too', () => {
    expect(cleanName('Vhagar\t\n NAS')).toBe('Vhagar NAS')
  })

  it('is null for an empty or blank name', () => {
    expect(cleanName('')).toBeNull()
    expect(cleanName('   ')).toBeNull()
  })

  it('accepts exactly NAME_MAX characters and refuses one more', () => {
    expect(cleanName('a'.repeat(NAME_MAX))).toBe('a'.repeat(NAME_MAX))
    expect(cleanName('a'.repeat(NAME_MAX + 1))).toBeNull()
    expect(NAME_MAX).toBe(80)
  })

  it('measures the cleaned name, not the raw one', () => {
    expect(cleanName(`  ${'a'.repeat(NAME_MAX)}  `)).toBe('a'.repeat(NAME_MAX))
  })

  it('is null for a format character, a bidi override or a zero width', () => {
    expect(cleanName('a\u202eb')).toBeNull()
    expect(cleanName('a\u200bb')).toBeNull()
    expect(cleanName('a\u2066b')).toBeNull()
  })

  it('keeps the joiners an emoji or a script needs', () => {
    expect(cleanName('\u{1F468}\u200d\u{1F469}\u200d\u{1F467} Home')).toBe(
      '\u{1F468}\u200d\u{1F469}\u200d\u{1F467} Home',
    )
    expect(cleanName('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645')).toBe(
      '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645',
    )
  })

  it('keeps the tag characters of a subdivision flag', () => {
    const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
    expect(cleanName(`${scotland} NAS`)).toBe(`${scotland} NAS`)
  })

  it('counts a name by code points, so 80 astral characters fit and 81 do not', () => {
    expect(cleanName('\u{1F985}'.repeat(NAME_MAX))).toBe('\u{1F985}'.repeat(NAME_MAX))
    expect(cleanName('\u{1F985}'.repeat(NAME_MAX + 1))).toBeNull()
  })

  it('is null for a control character', () => {
    expect(cleanName('a\u0007b')).toBeNull()
    expect(cleanName('a\u0000b')).toBeNull()
  })
})

describe('nameFor', () => {
  it('is the host of the origin', () => {
    expect(nameFor('https://raven.example.ts.net')).toBe('raven.example.ts.net')
  })

  it('keeps a port that is not the default', () => {
    expect(nameFor('http://127.0.0.1:8080')).toBe('127.0.0.1:8080')
  })

  it('shows an international name as punycode', () => {
    expect(nameFor('https://xn--rven-pqa.example')).toBe('xn--rven-pqa.example')
  })
})

describe('serverById and serverByOrigin', () => {
  const config = configOf({ count: 3 })

  it('find a stored server', () => {
    expect(serverById({ config, serverId: idFor({ n: 1 }) })).toEqual(entryFor({ n: 1 }))
    expect(serverByOrigin({ config, origin: originFor({ n: 2 }) })).toEqual(entryFor({ n: 2 }))
  })

  it('are null for an unknown id or origin', () => {
    expect(serverById({ config, serverId: idFor({ n: 9 }) })).toBeNull()
    expect(serverByOrigin({ config, origin: originFor({ n: 9 }) })).toBeNull()
  })
})

describe('addServer', () => {
  it('appends a server named after its host', () => {
    const outcome = addServer({
      config: EMPTY_CONFIG,
      id: idFor({ n: 1 }),
      origin: 'http://127.0.0.1:8080',
      at: 1700000000000,
    })
    const server = {
      id: idFor({ n: 1 }),
      origin: 'http://127.0.0.1:8080',
      name: '127.0.0.1:8080',
      addedAt: 1700000000000,
    }
    expect(outcome).toEqual({ ok: true, server, config: { ...EMPTY_CONFIG, servers: [server] } })
  })

  it('twice with the same origin keeps one entry and returns the first id', () => {
    const first = addServer({
      config: EMPTY_CONFIG,
      id: idFor({ n: 1 }),
      origin: originFor({ n: 1 }),
      at: 1,
    })
    if (!first.ok) throw new Error('expected the first add to succeed')
    const second = addServer({
      config: first.config,
      id: idFor({ n: 2 }),
      origin: originFor({ n: 1 }),
      at: 2,
    })
    if (!second.ok) throw new Error('expected the repeat add to succeed')
    expect(second.server.id).toBe(idFor({ n: 1 }))
    expect(second.config).toBe(first.config)
    expect(second.config.servers.length).toBe(1)
  })

  it('a stored origin is found even when the list is full', () => {
    const full = configOf({ count: SERVERS_CAP })
    const outcome = addServer({
      config: full,
      id: idFor({ n: 99 }),
      origin: originFor({ n: 4 }),
      at: 99,
    })
    expect(outcome).toEqual({ ok: true, server: entryFor({ n: 4 }), config: full })
  })

  it('refuses the twenty-first origin as full', () => {
    const full = configOf({ count: SERVERS_CAP })
    expect(
      addServer({ config: full, id: idFor({ n: 99 }), origin: originFor({ n: 99 }), at: 99 }),
    ).toEqual({
      ok: false,
      reason: 'full',
    })
    expect(SERVERS_CAP).toBe(20)
    expect(SERVERS_CAP).toBe(CONFIG_SERVERS_CAP)
  })

  it('accepts the twentieth origin', () => {
    const config = configOf({ count: SERVERS_CAP - 1 })
    const outcome = addServer({
      config,
      id: idFor({ n: 99 }),
      origin: originFor({ n: 99 }),
      at: 99,
    })
    expect(outcome.ok && outcome.config.servers.length).toBe(SERVERS_CAP)
  })

  it.each(['https://S9.example', 'https://s9.example/', 'https://s9.example.', 'not an origin'])(
    'refuses the origin %p that is not canonical',
    (origin) => {
      expect(addServer({ config: EMPTY_CONFIG, id: idFor({ n: 9 }), origin, at: 9 })).toEqual({
        ok: false,
        reason: 'invalid',
      })
    },
  )

  it('refuses an id that is not opaque', () => {
    expect(
      addServer({ config: EMPTY_CONFIG, id: '../x', origin: originFor({ n: 9 }), at: 9 }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('refuses an id another server has, as taken', () => {
    expect(
      addServer({
        config: configOf({ count: 2 }),
        id: idFor({ n: 1 }),
        origin: originFor({ n: 9 }),
        at: 9,
      }),
    ).toEqual({ ok: false, reason: 'taken' })
  })

  it('does not mutate its input', () => {
    const config = configOf({ count: 2 })
    const before = structuredClone(config)
    addServer({ config, id: idFor({ n: 9 }), origin: originFor({ n: 9 }), at: 9 })
    addServer({ config, id: idFor({ n: 8 }), origin: originFor({ n: 1 }), at: 8 })
    expect(config).toEqual(before)
  })
})

describe('renameServer', () => {
  it('renames one server with the cleaned name and leaves the others', () => {
    const config = configOf({ count: 3 })
    const next = renameServer({ config, serverId: idFor({ n: 1 }), name: '  Vhagar   NAS ' })
    expect(next?.servers.map((server) => server.name) ?? []).toEqual([
      'Server 0',
      'Vhagar NAS',
      'Server 2',
    ])
    expect(next?.servers[1] ?? null).toEqual({ ...entryFor({ n: 1 }), name: 'Vhagar NAS' })
  })

  it('is null for an unknown id', () => {
    expect(
      renameServer({ config: configOf({ count: 2 }), serverId: idFor({ n: 9 }), name: 'NAS' }),
    ).toBeNull()
  })

  it('is null for a name that cleanName refuses', () => {
    const config = configOf({ count: 2 })
    expect(renameServer({ config, serverId: idFor({ n: 1 }), name: '   ' })).toBeNull()
    expect(renameServer({ config, serverId: idFor({ n: 1 }), name: 'a\u0007b' })).toBeNull()
  })

  it('does not mutate its input', () => {
    const config = configOf({ count: 2 })
    const before = structuredClone(config)
    renameServer({ config, serverId: idFor({ n: 1 }), name: 'NAS' })
    expect(config).toEqual(before)
  })
})

describe('removeServer', () => {
  it('leaves the others in order', () => {
    const next = removeServer({ config: configOf({ count: 4 }), serverId: idFor({ n: 1 }) })
    expect(next.servers.map((server) => server.id)).toEqual([
      idFor({ n: 0 }),
      idFor({ n: 2 }),
      idFor({ n: 3 }),
    ])
  })

  it('keeps the output setting', () => {
    const config = { ...configOf({ count: 1 }), output: { ...EMPTY_CONFIG.output, spatial: true } }
    expect(removeServer({ config, serverId: idFor({ n: 0 }) }).output).toEqual(config.output)
  })

  it('an unknown id changes nothing', () => {
    const config = configOf({ count: 2 })
    expect(removeServer({ config, serverId: idFor({ n: 9 }) })).toBe(config)
  })

  it('does not mutate its input', () => {
    const config = configOf({ count: 3 })
    const before = structuredClone(config)
    removeServer({ config, serverId: idFor({ n: 1 }) })
    expect(config).toEqual(before)
  })
})
