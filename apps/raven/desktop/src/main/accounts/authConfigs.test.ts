import { describe, expect, it } from 'bun:test'
import { AUTH_CONFIG_STATES, AUTH_COOKIE, AUTH_PATHS } from '@raven/core'
import {
  AUTH_CONFIG_STALE_MS,
  AUTH_STATES,
  createAuthConfigs,
  RECHECK_AFTER_MS,
  type AuthState,
} from '@/main/accounts/authConfigs'
import type { SignInConfig } from '@/main/accounts/authEndpoints'
import { EMPTY_CONFIG, type ConfigStore, type DesktopConfig } from '@/main/desktopConfig'
import { CALL_NAMES } from '@/main/servers/allowlist'
import type { ServerCallResult, ServerCalls } from '@/main/servers/serverCalls'
import { until } from '@/main/test/downloadFakes'

const SERVER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'
const NAME = 'Vhagar'

const PIN: SignInConfig = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_example',
  webUrl: 'https://raven.example',
}
const MOVED: SignInConfig = { ...PIN, supabaseUrl: 'https://elsewhere.supabase.co' }

const readyBody = (signIn: SignInConfig) => ({
  state: AUTH_CONFIG_STATES.ready,
  ...signIn,
  cookieName: AUTH_COOKIE,
})

const body = (value: unknown): ServerCallResult => ({
  ok: true,
  status: 200,
  body: JSON.stringify(value),
})

const ENTRY = {
  id: SERVER_ID,
  origin: 'https://raven.example',
  name: NAME,
  addedAt: 1,
  signIn: null,
} as const

const memoryConfig = ({ signIn }: { signIn: SignInConfig | null }) => {
  const state: { value: DesktopConfig; updates: number } = {
    value: { ...EMPTY_CONFIG, servers: [{ ...ENTRY, signIn }] },
    updates: 0,
  }
  const store: ConfigStore = {
    read: () => state.value,
    update: (change) => {
      state.updates += 1
      state.value = change(state.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
  return { store, state }
}

const pinOf = ({ state }: { state: { value: DesktopConfig } }): SignInConfig | null =>
  state.value.servers.find((server) => server.id === SERVER_ID)?.signIn ?? null

type Answer = ServerCallResult | (() => Promise<ServerCallResult>)

const setup = ({
  signIn = null,
  answers = [],
  confirms = [],
  isForgetBroken = false,
  isConfirmBroken = false,
}: {
  signIn?: SignInConfig | null
  answers?: Answer[]
  confirms?: boolean[]
  isForgetBroken?: boolean
  isConfirmBroken?: boolean
} = {}) => {
  const { store, state } = memoryConfig({ signIn })
  const log: string[] = []
  const sent: { serverId: string; name: string }[] = []
  const asked: { serverName: string; host: string }[] = []
  const warnings: string[] = []
  const queue = [...answers]
  const replies = [...confirms]
  const clock = { now: 0 }
  const calls: Pick<ServerCalls, 'call'> = {
    call: async ({ serverId, call }) => {
      sent.push({ serverId, name: call.name })
      log.push('call')
      const next = queue.shift()
      if (next === undefined) return { ok: false, message: 'no answer queued' }
      return typeof next === 'function' ? next() : next
    },
  }
  const configs = createAuthConfigs({
    calls,
    config: store,
    confirm: async (input) => {
      asked.push(input)
      log.push('confirm')
      if (isConfirmBroken) throw new Error('no window')
      return replies.shift() ?? false
    },
    forget: async (serverId) => {
      log.push(`forget ${serverId}`)
      if (isForgetBroken) throw new Error('session busy')
    },
    now: () => clock.now,
    warn: (message) => warnings.push(message),
  })
  return { configs, state, log, sent, asked, warnings, clock }
}

const KINDS = (state: AuthState) => state.kind

describe('AUTH_STATES', () => {
  it('names the six states', () => {
    expect(AUTH_STATES).toEqual({
      off: 'off',
      legacy: 'legacy',
      down: 'down',
      unavailable: 'unavailable',
      ready: 'ready',
      unreachable: 'unreachable',
    })
  })
})

describe('createAuthConfigs stateOf', () => {
  it('reads the server through its public auth config call', async () => {
    const world = setup({ answers: [body({ state: AUTH_CONFIG_STATES.off })] })
    await world.configs.stateOf(SERVER_ID)
    expect(world.sent).toEqual([{ serverId: SERVER_ID, name: CALL_NAMES.getAuthConfig }])
    expect(AUTH_PATHS.config).toBe('/api/auth/config')
  })

  it('is off for accounts that are off', async () => {
    const world = setup({ answers: [body({ state: AUTH_CONFIG_STATES.off })] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.off })
  })

  it('is down for accounts the server says are unavailable', async () => {
    const world = setup({ answers: [body({ state: AUTH_CONFIG_STATES.unavailable })] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.down })
  })

  it('is legacy for a 404, a server older than accounts', async () => {
    const world = setup({ answers: [{ ok: true, status: 404, body: '' }] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.legacy })
  })

  it('is ready with the endpoints raven player reads from them', async () => {
    const world = setup({
      signIn: PIN,
      answers: [body({ ...readyBody(PIN), supabaseUrl: 'HTTPS://Project.Supabase.co/' })],
    })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({
      kind: AUTH_STATES.ready,
      signIn: PIN,
    })
  })

  it('is unavailable for a ready config whose endpoints raven player cannot use, and warns', async () => {
    const world = setup({
      signIn: PIN,
      answers: [body({ ...readyBody(PIN), supabaseUrl: 'http://project.supabase.co' })],
    })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.unavailable })
    expect(world.warnings).toHaveLength(1)
    expect(world.asked).toEqual([])
    expect(pinOf(world)).toEqual(PIN)
  })

  it.each([
    ['a call that did not reach the server', { ok: false, message: 'down' } as const],
    ['a 500', { ok: true, status: 500, body: '{"state":"off"}' } as const],
    ['a 503', { ok: true, status: 503, body: '{"state":"off"}' } as const],
    ['HTML', { ok: true, status: 200, body: '<html>' } as const],
    ['JSON that is not an auth config', { ok: true, status: 200, body: '{"ok":1}' } as const],
    ['a ready config without its endpoints', body({ state: AUTH_CONFIG_STATES.ready })],
  ])('is unreachable for %s', async (_, answer) => {
    const world = setup({ answers: [answer] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.unreachable })
  })

  it('is unreachable for a server it does not know, without asking anyone', async () => {
    const world = setup({ answers: [body({ state: AUTH_CONFIG_STATES.off })] })
    expect(await world.configs.stateOf(OTHER_ID)).toEqual({ kind: AUTH_STATES.unreachable })
    expect(world.sent).toEqual([])
  })

  it('keeps the answer in memory, so a second ask makes no call', async () => {
    const world = setup({
      answers: [
        body({ state: AUTH_CONFIG_STATES.off }),
        body({ state: AUTH_CONFIG_STATES.unavailable }),
      ],
    })
    await world.configs.stateOf(SERVER_ID)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(world.sent).toHaveLength(1)
  })

  it('keeps legacy too', async () => {
    const world = setup({
      answers: [{ ok: true, status: 404, body: '' }, body({ state: AUTH_CONFIG_STATES.off })],
    })
    await world.configs.stateOf(SERVER_ID)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.legacy)
    expect(world.sent).toHaveLength(1)
  })

  it('reads again after an unreachable answer, which is not kept', async () => {
    const world = setup({
      answers: [{ ok: false, message: 'down' }, body({ state: AUTH_CONFIG_STATES.off })],
    })
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.unreachable)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(world.sent).toHaveLength(2)
  })

  it('shares one read between asks made while it is out', async () => {
    const release: (() => void)[] = []
    const world = setup({
      answers: [
        () =>
          new Promise((resolve) => {
            release.push(() => resolve(body({ state: AUTH_CONFIG_STATES.off })))
          }),
      ],
    })
    const first = world.configs.stateOf(SERVER_ID)
    const second = world.configs.stateOf(SERVER_ID)
    release.forEach((run) => run())
    expect(await Promise.all([first, second])).toEqual([
      { kind: AUTH_STATES.off },
      { kind: AUTH_STATES.off },
    ])
    expect(world.sent).toHaveLength(1)
  })

  it('does not bring a pin back for a server removed while its config was read', async () => {
    const release: (() => void)[] = []
    const world = setup({
      answers: [
        () =>
          new Promise((resolve) => {
            release.push(() => resolve(body(readyBody(PIN))))
          }),
      ],
    })
    const pending = world.configs.stateOf(SERVER_ID)
    world.state.value = { ...world.state.value, servers: [] }
    release.forEach((run) => run())
    expect(await pending).toEqual({ kind: AUTH_STATES.unreachable })
    expect(world.state.updates).toBe(0)
  })
})

describe('createAuthConfigs pinning', () => {
  it('pins a server with no pin on its first ready read, without asking', async () => {
    const world = setup({ answers: [body(readyBody(PIN))] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({
      kind: AUTH_STATES.ready,
      signIn: PIN,
    })
    expect(pinOf(world)).toEqual(PIN)
    expect(world.asked).toEqual([])
    expect(world.log).toEqual(['call'])
  })

  it('does not ask when the config matches the pin, and writes nothing', async () => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(PIN))] })
    await world.configs.stateOf(SERVER_ID)
    expect(world.asked).toEqual([])
    expect(world.state.updates).toBe(0)
  })

  it.each([
    ['the Supabase URL', MOVED],
    ['the publishable key', { ...PIN, publishableKey: 'sb_publishable_other' }],
    ['the web URL', { ...PIN, webUrl: 'https://other.example' }],
  ])('asks once when %s changed', async (_, changed) => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(changed))], confirms: [true] })
    await world.configs.stateOf(SERVER_ID)
    expect(world.asked).toEqual([{ serverName: NAME, host: new URL(changed.supabaseUrl).host }])
  })

  it('names the new Supabase host in the question, with its port', async () => {
    const local = { ...PIN, supabaseUrl: 'http://localhost:54321' }
    const world = setup({ signIn: PIN, answers: [body(readyBody(local))], confirms: [true] })
    await world.configs.stateOf(SERVER_ID)
    expect(world.asked).toEqual([{ serverName: NAME, host: 'localhost:54321' }])
  })

  it('on a yes drops the old session, then pins the new endpoints and is ready with them', async () => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(MOVED))], confirms: [true] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({
      kind: AUTH_STATES.ready,
      signIn: MOVED,
    })
    expect(pinOf(world)).toEqual(MOVED)
    expect(world.log).toEqual(['call', 'confirm', `forget ${SERVER_ID}`])
  })

  it('on a no leaves the pin, keeps the old session and makes the server unavailable', async () => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(MOVED))], confirms: [false] })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.unavailable })
    expect(pinOf(world)).toEqual(PIN)
    expect(world.state.updates).toBe(0)
    expect(world.log).toEqual(['call', 'confirm'])
  })

  it('does not ask again on later asks after a no, only on a re-read', async () => {
    const world = setup({
      signIn: PIN,
      answers: [body(readyBody(MOVED)), body(readyBody(MOVED))],
      confirms: [false, true],
    })
    await world.configs.stateOf(SERVER_ID)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.unavailable)
    expect(world.asked).toHaveLength(1)
    expect(await world.configs.reread(SERVER_ID)).toEqual({
      kind: AUTH_STATES.ready,
      signIn: MOVED,
    })
    expect(world.asked).toHaveLength(2)
    expect(pinOf(world)).toEqual(MOVED)
  })

  it('asks once when several asks arrive while the question is open', async () => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(MOVED))], confirms: [true] })
    const all = await Promise.all([
      world.configs.stateOf(SERVER_ID),
      world.configs.stateOf(SERVER_ID),
      world.configs.stateOf(SERVER_ID),
    ])
    expect(all.map(KINDS)).toEqual([AUTH_STATES.ready, AUTH_STATES.ready, AUTH_STATES.ready])
    expect(world.asked).toHaveLength(1)
  })

  it('treats a question that fails as a no, and warns', async () => {
    const world = setup({
      signIn: PIN,
      answers: [body(readyBody(MOVED))],
      isConfirmBroken: true,
    })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.unavailable })
    expect(pinOf(world)).toEqual(PIN)
    expect(world.warnings.join('\n')).toContain('no window')
  })

  it('keeps the old pin and is unavailable when the old session cannot be dropped', async () => {
    const world = setup({
      signIn: PIN,
      answers: [body(readyBody(MOVED))],
      confirms: [true],
      isForgetBroken: true,
    })
    expect(await world.configs.stateOf(SERVER_ID)).toEqual({ kind: AUTH_STATES.unavailable })
    expect(pinOf(world)).toEqual(PIN)
    expect(world.warnings.join('\n')).toContain('session busy')
  })

  it.each([
    ['off', body({ state: AUTH_CONFIG_STATES.off })],
    ['unavailable', body({ state: AUTH_CONFIG_STATES.unavailable })],
    ['legacy', { ok: true, status: 404, body: '' } as const],
    ['unreachable', { ok: false, message: 'down' } as const],
  ])('never replaces or clears a pin when the server answers %s', async (_, answer) => {
    const world = setup({ signIn: PIN, answers: [answer] })
    await world.configs.stateOf(SERVER_ID)
    expect(pinOf(world)).toEqual(PIN)
    expect(world.state.updates).toBe(0)
    expect(world.asked).toEqual([])
  })

  it('never lets a log line carry the keys it read', async () => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(MOVED))], confirms: [false] })
    await world.configs.stateOf(SERVER_ID)
    expect(world.warnings.join('\n')).not.toContain(PIN.publishableKey)
  })
})

describe('createAuthConfigs reread', () => {
  it('reads the server again whatever was kept', async () => {
    const world = setup({
      answers: [body({ state: AUTH_CONFIG_STATES.off }), body({ state: AUTH_CONFIG_STATES.off })],
    })
    await world.configs.stateOf(SERVER_ID)
    expect(KINDS(await world.configs.reread(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(world.sent).toHaveLength(2)
  })

  it('reads a server whose accounts were down again, rather than keeping it down', async () => {
    const world = setup({
      answers: [body({ state: AUTH_CONFIG_STATES.unavailable }), body(readyBody(PIN))],
    })
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.down)
    expect(world.configs.readyOf(SERVER_ID)).toBeNull()
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.ready)
    expect(world.configs.readyOf(SERVER_ID)).toEqual(PIN)
    expect(world.sent).toHaveLength(2)
  })

  it('keeps a sign-in move the person turned down, without asking again', async () => {
    const world = setup({ signIn: PIN, answers: [body(readyBody(MOVED))], confirms: [false] })
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.unavailable)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.unavailable)
    expect(world.sent).toHaveLength(1)
  })

  it('pins a server that turned ready since it was last read', async () => {
    const world = setup({
      answers: [body({ state: AUTH_CONFIG_STATES.off }), body(readyBody(PIN))],
    })
    await world.configs.stateOf(SERVER_ID)
    expect(await world.configs.reread(SERVER_ID)).toEqual({
      kind: AUTH_STATES.ready,
      signIn: PIN,
    })
    expect(pinOf(world)).toEqual(PIN)
  })

  it('joins a read already out instead of starting another', async () => {
    const release: (() => void)[] = []
    const world = setup({
      answers: [
        () =>
          new Promise((resolve) => {
            release.push(() => resolve(body({ state: AUTH_CONFIG_STATES.off })))
          }),
      ],
    })
    const first = world.configs.stateOf(SERVER_ID)
    const second = world.configs.reread(SERVER_ID)
    release.forEach((run) => run())
    await Promise.all([first, second])
    expect(world.sent).toHaveLength(1)
  })
})

describe('createAuthConfigs readyOf', () => {
  it('is null until the server has been read, and asks nobody', () => {
    const world = setup()
    expect(world.configs.readyOf(SERVER_ID)).toBeNull()
    expect(world.sent).toEqual([])
  })

  it('is the endpoints of a server whose accounts are ready', async () => {
    const world = setup({ answers: [body(readyBody(PIN))] })
    await world.configs.stateOf(SERVER_ID)
    expect(world.configs.readyOf(SERVER_ID)).toEqual(PIN)
  })

  it('is null for a server whose accounts are off, or that left ready', async () => {
    const world = setup({
      answers: [body(readyBody(PIN)), body({ state: AUTH_CONFIG_STATES.off })],
    })
    await world.configs.stateOf(SERVER_ID)
    await world.configs.reread(SERVER_ID)
    expect(world.configs.readyOf(SERVER_ID)).toBeNull()
  })

  it('stays null after a no to a moved sign-in, which makes the server unavailable', async () => {
    const world = setup({
      signIn: PIN,
      confirms: [false],
      answers: [body(readyBody(PIN)), body(readyBody(MOVED))],
    })
    await world.configs.stateOf(SERVER_ID)
    await world.configs.reread(SERVER_ID)
    expect(world.configs.readyOf(SERVER_ID)).toBeNull()
  })
})

describe('createAuthConfigs a sign-in move turned down', () => {
  it('is not asked about again when the server is read for any reason but a person asking', async () => {
    const world = setup({
      signIn: PIN,
      answers: [body(readyBody(MOVED)), body(readyBody(MOVED)), body(readyBody(MOVED))],
      confirms: [false],
    })
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.unavailable)
    world.clock.now += RECHECK_AFTER_MS
    expect(KINDS(await world.configs.recheck(SERVER_ID))).toBe(AUTH_STATES.unavailable)
    world.clock.now += AUTH_CONFIG_STALE_MS
    await world.configs.stateOf(SERVER_ID)
    await world.configs.stateOf(SERVER_ID)
    expect(world.sent).toHaveLength(3)
    expect(world.asked).toHaveLength(1)
    expect(pinOf(world)).toEqual(PIN)
  })

  it('is asked about again when the server moves somewhere else', async () => {
    const elsewhere = { ...PIN, supabaseUrl: 'https://third.supabase.co' }
    const world = setup({
      signIn: PIN,
      answers: [body(readyBody(MOVED)), body(readyBody(elsewhere))],
      confirms: [false, true],
    })
    await world.configs.stateOf(SERVER_ID)
    world.clock.now += RECHECK_AFTER_MS
    expect(await world.configs.recheck(SERVER_ID)).toEqual({
      kind: AUTH_STATES.ready,
      signIn: elsewhere,
    })
    expect(world.asked).toHaveLength(2)
  })

  it('is asked about again by a person asking while another read is out', async () => {
    const release: (() => void)[] = []
    const world = setup({
      signIn: PIN,
      answers: [
        body(readyBody(MOVED)),
        () =>
          new Promise((resolve) => {
            release.push(() => resolve(body(readyBody(MOVED))))
          }),
      ],
      confirms: [false, true],
    })
    await world.configs.stateOf(SERVER_ID)
    world.clock.now += RECHECK_AFTER_MS
    const automatic = world.configs.recheck(SERVER_ID)
    const asked = world.configs.reread(SERVER_ID)
    release.forEach((run) => run())
    expect((await Promise.all([automatic, asked])).map(KINDS)).toEqual([
      AUTH_STATES.ready,
      AUTH_STATES.ready,
    ])
    expect(world.sent).toHaveLength(2)
    expect(pinOf(world)).toEqual(MOVED)
  })
})

describe('createAuthConfigs recheck', () => {
  it('answers what is kept, without a call, for a server read within the last 30 s', async () => {
    const world = setup({
      answers: [body({ state: AUTH_CONFIG_STATES.off }), body(readyBody(PIN))],
    })
    await world.configs.stateOf(SERVER_ID)
    world.clock.now += RECHECK_AFTER_MS - 1
    expect(KINDS(await world.configs.recheck(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(world.sent).toHaveLength(1)
    expect(RECHECK_AFTER_MS).toBe(30_000)
  })

  it('reads the server again once 30 s have passed', async () => {
    const world = setup({
      answers: [body({ state: AUTH_CONFIG_STATES.off }), body(readyBody(PIN))],
    })
    await world.configs.stateOf(SERVER_ID)
    world.clock.now += RECHECK_AFTER_MS
    expect(KINDS(await world.configs.recheck(SERVER_ID))).toBe(AUTH_STATES.ready)
    expect(world.sent).toHaveLength(2)
  })

  it('is unreachable, without a call, right after a read that reached nobody', async () => {
    const world = setup({ answers: [{ ok: false, message: 'down' }] })
    await world.configs.stateOf(SERVER_ID)
    expect(KINDS(await world.configs.recheck(SERVER_ID))).toBe(AUTH_STATES.unreachable)
    expect(world.sent).toHaveLength(1)
  })

  it('reads a server never read before', async () => {
    const world = setup({ answers: [body({ state: AUTH_CONFIG_STATES.off })] })
    expect(KINDS(await world.configs.recheck(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(world.sent).toHaveLength(1)
  })
})

describe('createAuthConfigs staleness', () => {
  it('answers a state kept too long as it is, and reads the server again behind it', async () => {
    const world = setup({
      answers: [body(readyBody(PIN)), body({ state: AUTH_CONFIG_STATES.off })],
    })
    await world.configs.stateOf(SERVER_ID)
    world.clock.now += AUTH_CONFIG_STALE_MS
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.ready)
    expect(world.sent).toHaveLength(2)
    await until(() => world.configs.readyOf(SERVER_ID) === null)
    expect(KINDS(await world.configs.stateOf(SERVER_ID))).toBe(AUTH_STATES.off)
    expect(world.sent).toHaveLength(2)
  })

  it('makes no call for a state kept less than ten minutes', async () => {
    const world = setup({ answers: [body(readyBody(PIN))] })
    await world.configs.stateOf(SERVER_ID)
    world.clock.now += AUTH_CONFIG_STALE_MS - 1
    await world.configs.stateOf(SERVER_ID)
    expect(world.sent).toHaveLength(1)
    expect(AUTH_CONFIG_STALE_MS).toBe(600_000)
  })
})

describe('createAuthConfigs hasAccounts', () => {
  it('is true for a server read ready, and for one pinned with accounts that has not been read', async () => {
    const ready = setup({ answers: [body(readyBody(PIN))] })
    expect(ready.configs.hasAccounts(SERVER_ID)).toBe(false)
    await ready.configs.stateOf(SERVER_ID)
    expect(ready.configs.hasAccounts(SERVER_ID)).toBe(true)
    const pinned = setup({ signIn: PIN })
    expect(pinned.configs.hasAccounts(SERVER_ID)).toBe(true)
    expect(pinned.log).toEqual([])
  })

  it('is false for a server read off or legacy, though a pin is left from when it had accounts', async () => {
    const off = setup({ signIn: PIN, answers: [body({ state: AUTH_CONFIG_STATES.off })] })
    await off.configs.stateOf(SERVER_ID)
    expect(off.configs.hasAccounts(SERVER_ID)).toBe(false)
    const legacy = setup({ signIn: PIN, answers: [{ ok: true, status: 404, body: '' }] })
    await legacy.configs.stateOf(SERVER_ID)
    expect(legacy.configs.hasAccounts(SERVER_ID)).toBe(false)
  })

  it('goes by the pin for a server whose accounts are down or that it cannot reach', async () => {
    const down = setup({ signIn: PIN, answers: [body({ state: AUTH_CONFIG_STATES.unavailable })] })
    await down.configs.stateOf(SERVER_ID)
    expect(down.configs.hasAccounts(SERVER_ID)).toBe(true)
    const unreached = setup({ answers: [{ ok: false, message: 'offline' }] })
    await unreached.configs.stateOf(SERVER_ID)
    expect(unreached.configs.hasAccounts(SERVER_ID)).toBe(false)
    expect(unreached.configs.hasAccounts(OTHER_ID)).toBe(false)
  })
})
