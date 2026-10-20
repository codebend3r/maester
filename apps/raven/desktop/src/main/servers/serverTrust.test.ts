import { describe, expect, it } from 'bun:test'
import { EMPTY_CONFIG, type DesktopConfig, type ServerEntry } from '@/main/desktopConfig'
import { PROBE_KINDS, type ProbeResult } from '@/main/servers/serverCalls'
import { createJsonStore, type StateFs } from '@/main/stateStore'
import { NAME_MAX, SERVERS_CAP, renameServer } from '@/main/servers/serverList'
import {
  TRUST_MESSAGES,
  TRUST_OUTCOME_KINDS,
  TRUST_STEP_MS,
  createServerTrust,
  trustDetailFor,
  withTrustLog,
  type TrustOutcome,
} from '@/main/servers/serverTrust'
import { fakeTimers } from '@/main/test/playerFakes'
import { readPlayLink } from '@/shared/playLink'

const FILE = '/data/desktop-config.json'
const NOW = 1_700_000_000_000
const ORIGIN = 'https://raven.example'

const idFor = ({ n }: { n: number }): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const entryFor = ({ n }: { n: number }): ServerEntry => ({
  id: idFor({ n: 900 + n }),
  origin: `https://s${n}.example`,
  name: `Server ${n}`,
  addedAt: n,
  signIn: null,
})

const configWith = ({ servers }: { servers: ServerEntry[] }): DesktopConfig => ({
  ...EMPTY_CONFIG,
  servers,
})

/** A file system in memory whose writes can be made to fail. */
const fakeFs = () => {
  const files = new Map<string, string>()
  const state = { isBroken: false }
  const fs: StateFs = {
    readFile: async (path) => files.get(path) ?? '',
    writeFile: async ({ path, data }) => {
      if (state.isBroken) throw new Error('disk full')
      files.set(path, data)
    },
    rename: async ({ from, to }) => {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    },
  }
  return { fs, files, state }
}

/** A hand-resolved `confirm`: each call waits until the test answers it. */
const handConfirm = () => {
  const asked: string[] = []
  const answers: ((isYes: boolean) => void)[] = []
  const confirm = (origin: string): Promise<boolean> => {
    asked.push(origin)
    return new Promise((resolve) => {
      answers.push(resolve)
    })
  }
  const answer = (isYes: boolean) => {
    const next = answers.shift()
    if (next === undefined) throw new Error('nothing is waiting on confirm')
    next(isYes)
  }
  return { confirm, asked, answer }
}

const PROBE_ANSWERS = {
  raven: 'raven',
  ravenReady: 'ravenReady',
  badSignIn: 'badSignIn',
  notRaven: 'notRaven',
  throws: 'throws',
} as const

const SIGN_IN = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_example',
  webUrl: 'https://raven.example',
} as const

const RAVEN: ProbeResult = { kind: PROBE_KINDS.raven, signIn: null }
const UNREACHABLE: ProbeResult = { kind: PROBE_KINDS.unreachable }

const probeResultFor = (answer: ProbeAnswer): ProbeResult => {
  switch (answer) {
    case PROBE_ANSWERS.raven:
      return RAVEN
    case PROBE_ANSWERS.ravenReady:
      return { kind: PROBE_KINDS.raven, signIn: SIGN_IN }
    case PROBE_ANSWERS.badSignIn:
      return { kind: PROBE_KINDS.badSignIn }
    case PROBE_ANSWERS.notRaven:
    case PROBE_ANSWERS.throws:
      return UNREACHABLE
    default: {
      const unreachable: never = answer
      return unreachable
    }
  }
}

type ProbeAnswer = (typeof PROBE_ANSWERS)[keyof typeof PROBE_ANSWERS]

const setup = ({
  servers = [],
  probeAnswer = PROBE_ANSWERS.raven,
  isForgetBroken = false,
  ids = [],
}: {
  servers?: ServerEntry[]
  probeAnswer?: ProbeAnswer
  isForgetBroken?: boolean
  ids?: string[]
} = {}) => {
  const disk = fakeFs()
  const clock = fakeTimers()
  const errors: unknown[] = []
  const config = createJsonStore({
    fs: disk.fs,
    file: FILE,
    initial: configWith({ servers }),
    timers: clock.timers,
    debounceMs: 100,
    onError: (error) => errors.push(error),
  })
  const prompt = handConfirm()
  const log: string[] = []
  const probes: { serverId: string; origin: string }[] = []
  const forgotten: string[] = []
  const removed: string[] = []
  const warnings: string[] = []
  const counter = { next: 1 }
  const queued = [...ids]
  const trust = createServerTrust({
    config: {
      ...config,
      update: (change) => {
        log.push('update')
        config.update(change)
      },
    },
    confirm: prompt.confirm,
    probe: async (input) => {
      probes.push(input)
      log.push('probe')
      if (probeAnswer === PROBE_ANSWERS.throws) throw new Error('socket hang up')
      return probeResultFor(probeAnswer)
    },
    forget: async (serverId) => {
      forgotten.push(serverId)
      log.push('forget')
      if (isForgetBroken) throw new Error('session busy')
    },
    onRemoved: (serverId) => {
      removed.push(serverId)
      log.push('onRemoved')
    },
    newId: () => {
      const queuedId = queued.shift()
      if (queuedId !== undefined) return queuedId
      const id = idFor({ n: counter.next })
      counter.next += 1
      return id
    },
    now: () => NOW,
    timers: clock.timers,
    warn: (message) => warnings.push(message),
  })
  return {
    trust,
    config,
    disk,
    clock,
    errors,
    prompt,
    log,
    probes,
    forgotten,
    removed,
    warnings,
  }
}

/** Lets every pending microtask run, so a trust waiting on nothing but promises reaches its next step. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Starts a trust, answers its prompt and returns the outcome. */
const answered = async ({
  world,
  origin = ORIGIN,
  from = 'link',
  isYes,
}: {
  world: ReturnType<typeof setup>
  origin?: string
  from?: 'link' | 'app'
  isYes: boolean
}): Promise<TrustOutcome> => {
  const pending = world.trust.trust({ origin, from })
  await settle()
  world.prompt.answer(isYes)
  return pending
}

describe('TRUST_MESSAGES', () => {
  it('asks about the origin and nothing else', () => {
    expect(TRUST_MESSAGES.prompt(ORIGIN)).toBe('Add the raven server at https://raven.example?')
    expect(TRUST_MESSAGES.unreachable(ORIGIN)).toBe(
      'No raven server answered at https://raven.example.',
    )
    expect(TRUST_MESSAGES.full).toBe(
      'raven player keeps at most 20 servers. Remove one in Settings first.',
    )
    expect(TRUST_MESSAGES.busy).toBe('raven player is already asking about another server.')
  })
})

describe('trustDetailFor', () => {
  it('is the plain detail for an ASCII host, an address and a port', () => {
    expect(trustDetailFor({ origin: ORIGIN })).toBe(TRUST_MESSAGES.detail)
    expect(trustDetailFor({ origin: 'http://127.0.0.1:8080' })).toBe(TRUST_MESSAGES.detail)
    expect(trustDetailFor({ origin: 'http://[::1]:8080' })).toBe(TRUST_MESSAGES.detail)
  })

  it('spells out a punycode host in its own letters, isolated, as a warning', () => {
    // The first letter is Cyrillic er (U+0440), which looks like a Latin p.
    const origin = new URL('https://\u0440aypal.example').origin
    expect(origin).toBe('https://xn--aypal-uye.example')
    const detail = trustDetailFor({ origin })
    expect(detail.startsWith(TRUST_MESSAGES.detail)).toBe(true)
    expect(detail).toContain('\u2068\u0440aypal.example\u2069')
    expect(detail).toBe(
      `${TRUST_MESSAGES.detail} ${TRUST_MESSAGES.lookalike('\u0440aypal.example')}`,
    )
  })

  it('is the plain detail for something that is not an origin', () => {
    expect(trustDetailFor({ origin: 'not a url' })).toBe(TRUST_MESSAGES.detail)
  })
})

describe('createServerTrust', () => {
  it('trusts a stored origin with no prompt and no probe', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored] })
    const outcome = await world.trust.trust({ origin: stored.origin, from: 'link' })
    expect(outcome).toEqual({ kind: 'trusted', server: stored, isNew: false })
    expect(world.prompt.asked).toEqual([])
    expect(world.probes).toEqual([])
    expect(world.log).toEqual([])
  })

  it('finds a stored origin written with upper case, the default port or a slash', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored] })
    const outcomes = await Promise.all(
      ['HTTPS://S1.EXAMPLE', 'https://s1.example:443', 'https://s1.example/'].map((origin) =>
        world.trust.trust({ origin, from: 'link' }),
      ),
    )
    expect(outcomes).toEqual([
      { kind: 'trusted', server: stored, isNew: false },
      { kind: 'trusted', server: stored, isNew: false },
      { kind: 'trusted', server: stored, isNew: false },
    ])
    expect(world.prompt.asked).toEqual([])
  })

  it('keeps a renamed record as it is, unicode name and all', async () => {
    const stored = entryFor({ n: 1 })
    const renamed = renameServer({
      config: configWith({ servers: [stored] }),
      serverId: stored.id,
      name: 'Vhagar \u{1F409} NAS',
    })
    if (renamed === null) throw new Error('rename refused')
    const world = setup({ servers: renamed.servers })
    const outcome = await world.trust.trust({ origin: stored.origin, from: 'link' })
    expect(outcome).toEqual({
      kind: 'trusted',
      server: { ...stored, name: 'Vhagar \u{1F409} NAS' },
      isNew: false,
    })
  })

  it('asks for a different port or a different scheme as another server', async () => {
    const world = setup({ servers: [entryFor({ n: 1 })] })
    const outcome = answered({ world, origin: 'https://s1.example:8443', isYes: false })
    expect(await outcome).toEqual({ kind: 'declined' })
    expect(world.prompt.asked).toEqual(['https://s1.example:8443'])
  })

  it('refuses a host ending in a dot, which would duplicate the server without it', async () => {
    const world = setup({ servers: [entryFor({ n: 1 })] })
    const outcome = await world.trust.trust({ origin: 'https://s1.example.', from: 'link' })
    expect(outcome).toEqual({ kind: 'invalid' })
    expect(world.prompt.asked).toEqual([])
  })

  it.each([
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['https://user:pass@raven.example'],
    ['https://raven.example/path'],
    ['https://raven.example?x=1'],
    ['https://raven\u202e.example'],
    [''],
  ])('refuses %j as invalid without asking or fetching', async (origin) => {
    const world = setup()
    expect(await world.trust.trust({ origin, from: 'app' })).toEqual({ kind: 'invalid' })
    expect(world.prompt.asked).toEqual([])
    expect(world.probes).toEqual([])
  })

  it('asks once about an unknown origin, and a no fetches and stores nothing', async () => {
    const world = setup()
    const before = world.config.read()
    const outcome = await answered({ world, isYes: false })
    expect(outcome).toEqual({ kind: 'declined' })
    expect(world.prompt.asked).toEqual([ORIGIN])
    expect(world.probes).toEqual([])
    expect(world.forgotten).toEqual([])
    expect(world.log).toEqual([])
    expect(world.config.read()).toBe(before)
  })

  it('asks with the canonical origin, never the text it was given', async () => {
    const world = setup()
    const outcome = answered({ world, origin: 'HTTPS://Raven.Example:443/', isYes: false })
    await outcome
    expect(world.prompt.asked).toEqual([ORIGIN])
  })

  it('shows a punycode origin to the prompt as punycode', async () => {
    const world = setup()
    await answered({ world, origin: 'https://\u0440aypal.example', isYes: false })
    expect(world.prompt.asked).toEqual(['https://xn--aypal-uye.example'])
  })

  it('does not ask again from a link about an origin a link was declined for', async () => {
    const world = setup()
    await answered({ world, isYes: false })
    const again = await world.trust.trust({ origin: 'https://RAVEN.example/', from: 'link' })
    expect(again).toEqual({ kind: 'declined' })
    expect(world.prompt.asked).toEqual([ORIGIN])
  })

  it('asks again from the app after a link was declined, and a yes there stores it', async () => {
    const world = setup()
    await answered({ world, isYes: false })
    const outcome = await answered({ world, from: 'app', isYes: true })
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN])
    expect(outcome.kind).toBe('trusted')
  })

  it('does not remember a decline from the app', async () => {
    const world = setup()
    await answered({ world, from: 'app', isYes: false })
    await answered({ world, from: 'link', isYes: false })
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN])
  })

  it('probes with the new id and the origin after a yes, then stores the server by its host', async () => {
    const world = setup()
    const outcome = await answered({ world, isYes: true })
    const server = {
      id: idFor({ n: 1 }),
      origin: ORIGIN,
      name: 'raven.example',
      addedAt: NOW,
      signIn: null,
    }
    expect(world.probes).toEqual([{ serverId: idFor({ n: 1 }), origin: ORIGIN }])
    expect(outcome).toEqual({ kind: 'trusted', server, isNew: true })
    expect(world.config.read().servers).toEqual([server])
    expect(world.log).toEqual(['probe', 'update'])
    expect(world.forgotten).toEqual([])
  })

  it('writes the new server to disk', async () => {
    const world = setup()
    await answered({ world, isYes: true })
    await world.config.flush()
    const written: unknown = JSON.parse(world.disk.files.get(FILE) ?? 'null')
    expect(written).toEqual({
      ...EMPTY_CONFIG,
      servers: [
        { id: idFor({ n: 1 }), origin: ORIGIN, name: 'raven.example', addedAt: NOW, signIn: null },
      ],
    })
  })

  it('pins the sign-in a ready probe found with the new server, and writes it to disk', async () => {
    const world = setup({ probeAnswer: PROBE_ANSWERS.ravenReady })
    const outcome = await answered({ world, isYes: true })
    const server = {
      id: idFor({ n: 1 }),
      origin: ORIGIN,
      name: 'raven.example',
      addedAt: NOW,
      signIn: SIGN_IN,
    }
    expect(outcome).toEqual({ kind: TRUST_OUTCOME_KINDS.trusted, server, isNew: true })
    await world.config.flush()
    const written: unknown = JSON.parse(world.disk.files.get(FILE) ?? 'null')
    expect(written).toEqual({ ...EMPTY_CONFIG, servers: [server] })
  })

  it('stores a server whose accounts are off or older than accounts with no pin', async () => {
    const world = setup({ probeAnswer: PROBE_ANSWERS.raven })
    await answered({ world, isYes: true })
    expect(world.config.read().servers.map((server) => server.signIn)).toEqual([null])
  })

  it('refuses a server whose sign-in settings it cannot use, forgetting the fresh session and storing nothing', async () => {
    const world = setup({ probeAnswer: PROBE_ANSWERS.badSignIn })
    const before = world.config.read()
    const outcome = await answered({ world, isYes: true })
    expect(outcome).toEqual({ kind: TRUST_OUTCOME_KINDS.badSignIn })
    expect(world.prompt.asked).toEqual([ORIGIN])
    expect(world.forgotten).toEqual([idFor({ n: 1 })])
    expect(world.config.read()).toBe(before)
    expect(world.log).toEqual(['probe', 'forget'])
  })

  it('tells a person that sign-in settings are the problem', () => {
    expect(TRUST_MESSAGES.badSignIn).toBe(
      "That server's sign-in settings are not ones raven player can use.",
    )
  })

  it('asks again from a link after a server had sign-in settings it could not use', async () => {
    const world = setup({ probeAnswer: PROBE_ANSWERS.badSignIn })
    await answered({ world, isYes: true })
    await answered({ world, isYes: false })
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN])
  })

  it('names a punycode server by its punycode host, never its unicode letters', async () => {
    const world = setup()
    const outcome = await answered({ world, origin: 'https://\u0440aypal.example', isYes: true })
    if (outcome.kind !== TRUST_OUTCOME_KINDS.trusted)
      throw new Error(`expected trusted, got ${outcome.kind}`)
    expect(outcome.server.name).toBe('xn--aypal-uye.example')
  })

  it('names a server by its host and port when the port is not the default', async () => {
    const world = setup()
    const outcome = await answered({ world, origin: 'http://127.0.0.1:8080', isYes: true })
    if (outcome.kind !== TRUST_OUTCOME_KINDS.trusted)
      throw new Error(`expected trusted, got ${outcome.kind}`)
    expect(outcome.server.name).toBe('127.0.0.1:8080')
  })

  it('cuts a host longer than a name may be to the first NAME_MAX characters', async () => {
    const label = 'a'.repeat(60)
    const host = `${label}.${label}.example`
    const world = setup()
    const outcome = await answered({ world, origin: `https://${host}`, isYes: true })
    if (outcome.kind !== TRUST_OUTCOME_KINDS.trusted)
      throw new Error(`expected trusted, got ${outcome.kind}`)
    expect(outcome.server.name).toBe(host.slice(0, NAME_MAX))
    expect(outcome.server.origin).toBe(`https://${host}`)
    expect(world.config.read().servers.map((server) => server.name)).toEqual([
      host.slice(0, NAME_MAX),
    ])
  })

  it.each([[PROBE_ANSWERS.notRaven], [PROBE_ANSWERS.throws]])(
    'forgets the fresh session and stores nothing when the probe is %s',
    async (probeAnswer) => {
      const world = setup({ probeAnswer })
      const before = world.config.read()
      const outcome = await answered({ world, isYes: true })
      expect(outcome).toEqual({ kind: 'unreachable', origin: ORIGIN })
      expect(world.forgotten).toEqual([idFor({ n: 1 })])
      expect(world.config.read()).toBe(before)
      expect(world.log).toEqual(['probe', 'forget'])
    },
  )

  it('asks again from a link after a server was unreachable', async () => {
    const world = setup({ probeAnswer: PROBE_ANSWERS.notRaven })
    await answered({ world, isYes: true })
    await answered({ world, isYes: false })
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN])
  })

  it('answers busy to a second trust while the first waits on its prompt, without asking', async () => {
    const world = setup()
    const first = world.trust.trust({ origin: ORIGIN, from: 'link' })
    const second = await world.trust.trust({ origin: 'https://other.example', from: 'link' })
    const third = await world.trust.trust({ origin: ORIGIN, from: 'app' })
    expect(second).toEqual({ kind: 'busy' })
    expect(third).toEqual({ kind: 'busy' })
    await settle()
    expect(world.prompt.asked).toEqual([ORIGIN])
    world.prompt.answer(true)
    expect((await first).kind).toBe('trusted')
  })

  it('asks again from Settings once a busy prompt has ended', async () => {
    const world = setup()
    const first = world.trust.trust({ origin: ORIGIN, from: 'link' })
    expect(await world.trust.trust({ origin: 'https://other.example', from: 'app' })).toEqual({
      kind: 'busy',
    })
    await settle()
    world.prompt.answer(false)
    expect(await first).toEqual({ kind: 'declined' })
    const again = world.trust.trust({ origin: 'https://other.example', from: 'app' })
    await settle()
    expect(world.prompt.asked).toEqual([ORIGIN, 'https://other.example'])
    world.prompt.answer(true)
    expect((await again).kind).toBe('trusted')
  })

  it('counts a probe that never answers as unreachable after its budget, and is not busy after', async () => {
    const world = setup()
    const clock = fakeTimers()
    const forgotten: string[] = []
    const trust = createServerTrust({
      config: world.config,
      confirm: async () => true,
      probe: () => new Promise<ProbeResult>(() => undefined),
      forget: async (serverId) => {
        forgotten.push(serverId)
      },
      onRemoved: () => undefined,
      newId: () => idFor({ n: 7 }),
      now: () => NOW,
      timers: clock.timers,
      warn: (message) => world.warnings.push(message),
    })
    const pending = trust.trust({ origin: ORIGIN, from: 'link' })
    await settle()
    expect([...clock.pending.values()].map(({ ms }) => ms)).toEqual([TRUST_STEP_MS])
    clock.fire()
    expect(await pending).toEqual({ kind: 'unreachable', origin: ORIGIN })
    expect(forgotten).toEqual([idFor({ n: 7 })])
    expect(world.warnings.join('\n')).toContain(`${TRUST_STEP_MS} ms`)
    const again = trust.trust({ origin: 'https://other.example', from: 'app' })
    await settle()
    clock.fire()
    expect(await again).toEqual({ kind: 'unreachable', origin: 'https://other.example' })
  })

  it('goes on after its budget when clearing a session never settles', async () => {
    const world = setup()
    const clock = fakeTimers()
    const trust = createServerTrust({
      config: world.config,
      confirm: async () => true,
      probe: async () => UNREACHABLE,
      forget: () => new Promise<void>(() => undefined),
      onRemoved: () => undefined,
      newId: () => idFor({ n: 7 }),
      now: () => NOW,
      timers: clock.timers,
      warn: (message) => world.warnings.push(message),
    })
    const pending = trust.trust({ origin: ORIGIN, from: 'link' })
    await settle()
    clock.fire()
    expect(await pending).toEqual({ kind: 'unreachable', origin: ORIGIN })
    expect(clock.pending.size).toBe(0)
  })

  it('counts a truthy answer that is not true as a no', async () => {
    const world = setup()
    const trust = createServerTrust({
      config: world.config,
      confirm: async () => 'yes',
      probe: async (input) => {
        world.probes.push(input)
        return RAVEN
      },
      forget: async () => undefined,
      onRemoved: () => undefined,
      newId: () => idFor({ n: 1 }),
      now: () => NOW,
      timers: fakeTimers().timers,
      warn: () => undefined,
    })
    expect(await trust.trust({ origin: ORIGIN, from: 'app' })).toEqual({ kind: 'declined' })
    expect(world.probes).toEqual([])
    expect(world.config.read().servers).toEqual([])
  })

  it('answers busy while the probe is still out, then asks again once it ends', async () => {
    const world = setup()
    const release: (() => void)[] = []
    const slow = createServerTrust({
      config: world.config,
      confirm: async () => true,
      probe: () =>
        new Promise((resolve) => {
          release.push(() => resolve(RAVEN))
        }),
      forget: async () => undefined,
      onRemoved: () => undefined,
      newId: () => idFor({ n: 7 }),
      now: () => NOW,
      timers: fakeTimers().timers,
      warn: () => undefined,
    })
    const first = slow.trust({ origin: ORIGIN, from: 'link' })
    await settle()
    expect(await slow.trust({ origin: 'https://other.example', from: 'link' })).toEqual({
      kind: 'busy',
    })
    release.forEach((run) => run())
    expect((await first).kind).toBe('trusted')
  })

  it('is unsaved and fetches nothing when the new id is one a server already has', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored], ids: [stored.id] })
    const outcome = await answered({ world, isYes: true })
    expect(outcome).toEqual({ kind: 'unsaved' })
    expect(world.probes).toEqual([])
    expect(world.forgotten).toEqual([])
    expect(world.config.read().servers).toEqual([stored])
  })

  it('trusts a stored origin even while another prompt is open', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored] })
    const first = world.trust.trust({ origin: ORIGIN, from: 'link' })
    const outcome = await world.trust.trust({ origin: stored.origin, from: 'link' })
    expect(outcome).toEqual({ kind: 'trusted', server: stored, isNew: false })
    await settle()
    world.prompt.answer(false)
    await first
  })

  it('is full at the cap before any prompt or probe', async () => {
    const servers = Array.from({ length: SERVERS_CAP }, (_, n) => entryFor({ n }))
    const world = setup({ servers })
    expect(await world.trust.trust({ origin: ORIGIN, from: 'app' })).toEqual({ kind: 'full' })
    expect(await world.trust.trust({ origin: ORIGIN, from: 'link' })).toEqual({ kind: 'full' })
    expect(world.prompt.asked).toEqual([])
    expect(world.probes).toEqual([])
  })

  it('still trusts a stored origin at the cap', async () => {
    const servers = Array.from({ length: SERVERS_CAP }, (_, n) => entryFor({ n }))
    const world = setup({ servers })
    const outcome = await world.trust.trust({ origin: servers[3].origin, from: 'link' })
    expect(outcome).toEqual({ kind: 'trusted', server: servers[3], isNew: false })
  })

  it('is full, and forgets, when the list filled while the prompt was open', async () => {
    const world = setup({
      servers: Array.from({ length: SERVERS_CAP - 1 }, (_, n) => entryFor({ n })),
    })
    const pending = world.trust.trust({ origin: ORIGIN, from: 'app' })
    await settle()
    world.config.update((config) => ({
      ...config,
      servers: [...config.servers, entryFor({ n: 99 })],
    }))
    world.prompt.answer(true)
    expect(await pending).toEqual({ kind: 'full' })
    expect(world.forgotten).toEqual([idFor({ n: 1 })])
    expect(world.config.read().servers).toHaveLength(SERVERS_CAP)
  })

  it('keeps the first record, and forgets the fresh session, when the origin was stored meanwhile', async () => {
    const world = setup()
    const pending = world.trust.trust({ origin: ORIGIN, from: 'app' })
    await settle()
    const first = { id: idFor({ n: 50 }), origin: ORIGIN, name: 'Vhagar', addedAt: 5, signIn: null }
    world.config.update((config) => ({ ...config, servers: [first] }))
    world.prompt.answer(true)
    expect(await pending).toEqual({ kind: 'trusted', server: first, isNew: false })
    expect(world.forgotten).toEqual([idFor({ n: 1 })])
    expect(world.config.read().servers).toEqual([first])
  })

  it('asks a link again for an origin a link declined, once it was stored meanwhile and removed', async () => {
    const world = setup()
    await answered({ world, isYes: false })
    const pending = world.trust.trust({ origin: ORIGIN, from: 'app' })
    await settle()
    const first = { id: idFor({ n: 50 }), origin: ORIGIN, name: 'Vhagar', addedAt: 5, signIn: null }
    world.config.update((config) => ({ ...config, servers: [first] }))
    world.prompt.answer(true)
    expect(await pending).toEqual({ kind: 'trusted', server: first, isNew: false })
    expect(await world.trust.remove(first.id)).toBe(true)
    await answered({ world, isYes: false })
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN, ORIGIN])
  })

  it('still trusts the server in memory when the config write fails, and reports the failure', async () => {
    const world = setup()
    world.disk.state.isBroken = true
    const outcome = await answered({ world, isYes: true })
    expect(outcome.kind).toBe('trusted')
    await world.config.flush()
    expect(world.errors).toHaveLength(1)
    expect(world.disk.files.has(FILE)).toBe(false)
    world.disk.state.isBroken = false
    await world.config.flush()
    expect(world.disk.files.has(FILE)).toBe(true)
  })

  it('is unsaved, forgets, and stores nothing when the config cannot be updated', async () => {
    const world = setup()
    const trust = createServerTrust({
      config: {
        ...world.config,
        update: () => {
          throw new Error('store closed')
        },
      },
      confirm: async () => true,
      probe: async () => RAVEN,
      forget: async (serverId) => {
        world.forgotten.push(serverId)
      },
      onRemoved: () => undefined,
      newId: () => idFor({ n: 3 }),
      now: () => NOW,
      timers: fakeTimers().timers,
      warn: (message) => world.warnings.push(message),
    })
    expect(await trust.trust({ origin: ORIGIN, from: 'app' })).toEqual({ kind: 'unsaved' })
    expect(world.forgotten).toEqual([idFor({ n: 3 })])
    expect(world.warnings.join('\n')).toContain('store closed')
  })

  it('is unsaved and fetches nothing when the new id is not an opaque id', async () => {
    const world = setup({ ids: ['../../etc'] })
    const outcome = await answered({ world, isYes: true })
    expect(outcome).toEqual({ kind: 'unsaved' })
    expect(world.probes).toEqual([])
    expect(world.forgotten).toEqual([])
    expect(world.config.read().servers).toEqual([])
  })

  it('counts a prompt that fails as a no it does not remember', async () => {
    const world = setup()
    const trust = createServerTrust({
      config: world.config,
      confirm: async () => {
        throw new Error('no window')
      },
      probe: async (input) => {
        world.probes.push(input)
        return RAVEN
      },
      forget: async () => undefined,
      onRemoved: () => undefined,
      newId: () => idFor({ n: 1 }),
      now: () => NOW,
      timers: fakeTimers().timers,
      warn: (message) => world.warnings.push(message),
    })
    expect(await trust.trust({ origin: ORIGIN, from: 'link' })).toEqual({ kind: 'declined' })
    expect(world.probes).toEqual([])
    expect(world.warnings.join('\n')).toContain('no window')
    expect(await trust.trust({ origin: ORIGIN, from: 'link' })).toEqual({ kind: 'declined' })
    expect(world.warnings).toHaveLength(2)
  })

  it('warns when forgetting a failed probe session fails, and still answers', async () => {
    const world = setup({ probeAnswer: PROBE_ANSWERS.notRaven, isForgetBroken: true })
    expect(await answered({ world, isYes: true })).toEqual({ kind: 'unreachable', origin: ORIGIN })
    expect(world.warnings.join('\n')).toContain('session busy')
  })

  it('asks again from a link for a server that was removed', async () => {
    const world = setup()
    const added = await answered({ world, isYes: true })
    if (added.kind !== TRUST_OUTCOME_KINDS.trusted)
      throw new Error(`expected trusted, got ${added.kind}`)
    expect(await world.trust.remove(added.server.id)).toBe(true)
    const again = answered({ world, isYes: true })
    const outcome = await again
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN])
    expect(outcome).toEqual({
      kind: 'trusted',
      server: {
        id: idFor({ n: 2 }),
        origin: ORIGIN,
        name: 'raven.example',
        addedAt: NOW,
        signIn: null,
      },
      isNew: true,
    })
  })

  it('asks a link again for an origin added from the app after a link decline, then removed', async () => {
    const world = setup()
    await answered({ world, isYes: false })
    const added = await answered({ world, from: 'app', isYes: true })
    if (added.kind !== TRUST_OUTCOME_KINDS.trusted)
      throw new Error(`expected trusted, got ${added.kind}`)
    await world.trust.remove(added.server.id)
    await answered({ world, from: 'link', isYes: false })
    expect(world.prompt.asked).toEqual([ORIGIN, ORIGIN, ORIGIN])
  })

  it('reads a play link with a hundred and one next ids as nothing to trust', () => {
    const next = Array.from({ length: 101 }, (_, n) => n + 1).join(',')
    const link = `raven://play?server=${encodeURIComponent(ORIGIN)}&media=1&next=${next}`
    expect(readPlayLink(link)).toBeNull()
  })
})

describe('remove', () => {
  it('updates the config, then reports the removal, then forgets, and is true', async () => {
    const stored = entryFor({ n: 1 })
    const other = entryFor({ n: 2 })
    const world = setup({ servers: [stored, other] })
    expect(await world.trust.remove(stored.id)).toBe(true)
    expect(world.log).toEqual(['update', 'onRemoved', 'forget'])
    expect(world.forgotten).toEqual([stored.id])
    expect(world.removed).toEqual([stored.id])
    expect(world.config.read().servers).toEqual([other])
  })

  it('is false, and forgets nothing, when the config cannot be updated', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored] })
    const forgotten: string[] = []
    const removed: string[] = []
    const trust = createServerTrust({
      config: {
        ...world.config,
        update: () => {
          throw new Error('store closed')
        },
      },
      confirm: async () => false,
      probe: async () => UNREACHABLE,
      forget: async (serverId) => {
        forgotten.push(serverId)
      },
      onRemoved: (serverId) => {
        removed.push(serverId)
      },
      newId: () => idFor({ n: 1 }),
      now: () => NOW,
      timers: fakeTimers().timers,
      warn: (message) => world.warnings.push(message),
    })
    expect(await trust.remove(stored.id)).toBe(false)
    expect(forgotten).toEqual([])
    expect(removed).toEqual([])
    expect(world.config.read().servers).toEqual([stored])
    expect(world.warnings.join('\n')).toContain('store closed')
  })

  it('is false for an unknown id and calls nothing', async () => {
    const world = setup({ servers: [entryFor({ n: 1 })] })
    expect(await world.trust.remove(idFor({ n: 404 }))).toBe(false)
    expect(world.log).toEqual([])
  })

  it('warns when forgetting fails and still reports the removal', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored], isForgetBroken: true })
    expect(await world.trust.remove(stored.id)).toBe(true)
    expect(world.removed).toEqual([stored.id])
    expect(world.warnings.join('\n')).toContain('session busy')
    expect(world.config.read().servers).toEqual([])
  })

  it('warns when the removal listener throws, and is still true', async () => {
    const stored = entryFor({ n: 1 })
    const world = setup({ servers: [stored] })
    const trust = createServerTrust({
      config: world.config,
      confirm: async () => false,
      probe: async () => UNREACHABLE,
      forget: async () => undefined,
      onRemoved: () => {
        throw new Error('engine gone')
      },
      newId: () => idFor({ n: 1 }),
      now: () => NOW,
      timers: fakeTimers().timers,
      warn: (message) => world.warnings.push(message),
    })
    expect(await trust.remove(stored.id)).toBe(true)
    expect(world.warnings.join('\n')).toContain('engine gone')
  })
})

describe('withTrustLog', () => {
  const logged = ({ outcome }: { outcome: TrustOutcome }) => {
    const warnings: string[] = []
    const trust = withTrustLog({
      trust: { trust: async () => outcome, remove: async () => true },
      warn: (message) => {
        warnings.push(message)
      },
    })
    return { trust, warnings }
  }

  it('logs each outcome with the origin and where it came from, and answers it unchanged', async () => {
    const outcome: TrustOutcome = { kind: 'declined' }
    const { trust, warnings } = logged({ outcome })
    expect(await trust.trust({ origin: ORIGIN, from: 'link' })).toBe(outcome)
    expect(warnings).toEqual([`trust for ${ORIGIN} from a link: declined`])
  })

  it('names a trusted server by its id and whether it is new', async () => {
    const server = entryFor({ n: 1 })
    const { trust, warnings } = logged({ outcome: { kind: 'trusted', server, isNew: true } })
    await trust.trust({ origin: server.origin, from: 'app' })
    expect(warnings).toEqual([
      `trust for ${server.origin} from the app: trusted ${server.id} (new)`,
    ])
  })

  it('escapes what an origin could hide in a log line', async () => {
    const { trust, warnings } = logged({ outcome: { kind: 'invalid' } })
    await trust.trust({ origin: 'https://a\nforged line', from: 'link' })
    expect(warnings).toEqual(['trust for https://a\\u{a}forged line from a link: invalid'])
  })

  it('a throwing logger never changes the answer', async () => {
    const outcome: TrustOutcome = { kind: 'busy' }
    const trust = withTrustLog({
      trust: { trust: async () => outcome, remove: async () => true },
      warn: () => {
        throw new Error('log gone')
      },
    })
    expect(await trust.trust({ origin: ORIGIN, from: 'link' })).toBe(outcome)
  })

  it('passes removals straight through', async () => {
    const { trust } = logged({ outcome: { kind: 'declined' } })
    expect(await trust.remove(idFor({ n: 1 }))).toBe(true)
  })
})
