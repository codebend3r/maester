import { describe, expect, it } from 'bun:test'
import { AUTH_ROUTES, MEMBER_STATUSES } from '@raven/core'
import {
  ACCOUNT_MESSAGES,
  signInUnavailable,
  authorizeWith,
  createAccountService,
} from '@/main/accounts/accountService'
import { SIGN_IN_OUTCOMES, TOKEN_READS, type TokenRead } from '@/main/accounts/accountSessions'
import { createServerSignal } from '@/main/accounts/serverSignal'
import { AUTH_STATES, type AuthState } from '@/main/accounts/authConfigs'
import type { SignInConfig } from '@/main/accounts/authEndpoints'
import { EMPTY_CONFIG, type ConfigStore, type DesktopConfig } from '@/main/desktopConfig'
import { CALL_NAMES } from '@/main/servers/allowlist'
import type { ServerCallResult } from '@/main/servers/serverCalls'
import { ACCOUNT_PAGES, ACCOUNT_STATES, SERVER_GONE, type AccountView } from '@/shared/protocol'

const SERVER_ID = '00000000-0000-4000-8000-000000000001'
const NAME = 'Vhagar'
const EMAIL = 'ada@example.com'
const PASSWORD = 'correct horse battery staple'
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.access-token-body.signature'
const KEY = 'sb_publishable_example'
const SUPABASE = 'https://project.supabase.co'

const PIN: SignInConfig = {
  supabaseUrl: SUPABASE,
  publishableKey: KEY,
  webUrl: 'https://raven.example',
}

const READY: AuthState = { kind: AUTH_STATES.ready, signIn: PIN }

/** What the fakes record, beside the names of the calls made to the server. */
const EVENTS = {
  stateOf: 'stateOf',
  reread: 'reread',
  recheck: 'recheck',
  signIn: 'signIn',
  signOut: 'signOut',
  forget: 'forget',
} as const

const tokenReadOf = ({
  token,
  isAuthDown,
}: {
  token: string | null
  isAuthDown: boolean
}): TokenRead => {
  if (isAuthDown) return { kind: TOKEN_READS.unreachable }
  return token === null ? { kind: TOKEN_READS.none } : { kind: TOKEN_READS.token, token }
}

const accountBody = ({
  status = MEMBER_STATUSES.approved,
}: { status?: string } = {}): ServerCallResult => ({
  ok: true,
  status: 200,
  body: JSON.stringify({
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    email: EMAIL,
    status,
    isOwner: false,
  }),
})

const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'
const ACCOUNT_B = '30000000-0000-4000-8000-00000000000b'

type Setup = {
  /** The account a sign in signs in as. */
  signInAs?: string
  /** The account signed in before the test starts; null when no one is. */
  accountId?: string | null
  /** Whether reading the config again drops the session, as a yes to a moved sign-in host does. */
  isSessionDroppedOnReread?: boolean
  states?: AuthState[]
  rereads?: AuthState[]
  token?: string | null
  me?: ServerCallResult
  outcome?: (typeof SIGN_IN_OUTCOMES)[keyof typeof SIGN_IN_OUTCOMES]
  isRemembered?: boolean
  pin?: SignInConfig | null
  isBrowserBroken?: boolean
  isAuthDown?: boolean
}

const setup = ({
  signInAs = ACCOUNT_A,
  accountId = ACCOUNT_A,
  isSessionDroppedOnReread = false,
  states = [READY],
  rereads = [],
  token = TOKEN,
  me = accountBody(),
  outcome = SIGN_IN_OUTCOMES.signedIn,
  isRemembered = true,
  pin = PIN,
  isBrowserBroken = false,
  isAuthDown = false,
}: Setup = {}) => {
  const state: { config: DesktopConfig } = {
    config: {
      ...EMPTY_CONFIG,
      servers: [
        {
          id: SERVER_ID,
          origin: 'https://raven.example',
          name: NAME,
          addedAt: 1,
          signIn: pin,
        },
      ],
    },
  }
  const config: ConfigStore = {
    read: () => state.config,
    update: (change) => {
      state.config = change(state.config)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
  const events: string[] = []
  const emitted: AccountView[] = []
  const infos: string[] = []
  const warnings: string[] = []
  const opened: string[] = []
  const ended: string[] = []
  const signedInWith: SignInConfig[] = []
  const rereadQueue = [...rereads]
  const current: {
    state: AuthState
    token: string | null
    me: ServerCallResult
    accountId: string | null
  } = {
    state: states[0] ?? READY,
    token,
    me,
    accountId,
  }
  /** Each server whose signed in account changed, with the account signed in by then. */
  const switched: { serverId: string; accountId: string | null }[] = []
  const accessEnds = createServerSignal()
  accessEnds.listen(({ serverId }) => {
    ended.push(serverId)
  })
  const readAgain = async (event: string): Promise<AuthState> => {
    events.push(event)
    const next = rereadQueue.shift()
    if (next !== undefined) current.state = next
    return current.state
  }
  const service = createAccountService({
    authConfigs: {
      stateOf: async () => {
        events.push(EVENTS.stateOf)
        return current.state
      },
      reread: () => {
        if (isSessionDroppedOnReread) current.accountId = null
        return readAgain(EVENTS.reread)
      },
      recheck: () => readAgain(EVENTS.recheck),
    },
    sessions: {
      signIn: async (input) => {
        events.push(EVENTS.signIn)
        signedInWith.push(input.config)
        expect({ ...input, config: undefined }).toEqual({
          serverId: SERVER_ID,
          email: EMAIL,
          password: PASSWORD,
          config: undefined,
        })
        if (outcome === SIGN_IN_OUTCOMES.signedIn) {
          current.token = TOKEN
          current.accountId = signInAs
        }
        return { kind: outcome }
      },
      accessToken: async () => tokenReadOf({ token: current.token, isAuthDown }),
      signOut: async () => {
        events.push(EVENTS.signOut)
        current.token = null
        current.accountId = null
      },
      forget: async () => {
        events.push(EVENTS.forget)
        current.token = null
        current.accountId = null
      },
      accountIdOf: () => current.accountId,
    },
    calls: {
      call: async ({ call }) => {
        events.push(call.name)
        return current.me
      },
    },
    config,
    isRemembered: () => isRemembered,
    openExternal: async (url) => {
      if (isBrowserBroken) throw new Error('no browser')
      opened.push(url)
    },
    accessEnds,
    emit: (account) => {
      emitted.push(account)
    },
    info: (message) => infos.push(message),
    warn: (message) => warnings.push(message),
    switched: ({ serverId }) => {
      switched.push({ serverId, accountId: current.accountId })
    },
  })
  return {
    service,
    switched,
    events,
    emitted,
    infos,
    warnings,
    opened,
    ended,
    current,
    accessEnds,
    signedInWith,
  }
}

const viewOf = (overrides: Partial<AccountView>): AccountView => ({
  serverId: SERVER_ID,
  state: ACCOUNT_STATES.approved,
  email: EMAIL,
  isRemembered: true,
  signInHost: 'project.supabase.co',
  ...overrides,
})

describe('ACCOUNT_MESSAGES', () => {
  it('says what the Settings sign in form is specified to say', () => {
    expect(ACCOUNT_MESSAGES.wrongPassword).toBe('Email or password is wrong.')
    expect(ACCOUNT_MESSAGES.unconfirmed).toBe(
      'Confirm your email first. The link is in your inbox.',
    )
    expect(ACCOUNT_MESSAGES.rateLimited).toBe('Wait a moment before trying again.')
    expect(signInUnavailable({ name: 'Vhagar' })).toBe(
      'Vhagar could not sign you in right now. Try again.',
    )
  })

  it('is plain copy with no dash', () => {
    Object.values(ACCOUNT_MESSAGES).forEach((message) => {
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toMatch(/[\u2013\u2014]/u)
    })
  })
})

describe('createAccountService read', () => {
  it.each([
    [AUTH_STATES.off, ACCOUNT_STATES.off],
    [AUTH_STATES.legacy, ACCOUNT_STATES.off],
    [AUTH_STATES.down, ACCOUNT_STATES.unavailable],
    [AUTH_STATES.unavailable, ACCOUNT_STATES.unavailable],
    [AUTH_STATES.unreachable, ACCOUNT_STATES.failed],
  ])(
    'is the %s auth state as %s, with no email and no calls to the server',
    async (kind, state) => {
      const world = setup({ states: [{ kind }] })
      expect(await world.service.read(SERVER_ID)).toEqual(
        viewOf({ state, email: null, signInHost: null }),
      )
      expect(world.events).toEqual([EVENTS.stateOf])
    },
  )

  it('is off, as a server without accounts, when one never pinned with accounts cannot be read', async () => {
    const world = setup({ states: [{ kind: AUTH_STATES.unreachable }], pin: null })
    expect(await world.service.read(SERVER_ID)).toEqual(
      viewOf({ state: ACCOUNT_STATES.off, email: null, signInHost: null }),
    )
    expect(world.events).toEqual([EVENTS.stateOf])
  })

  it('is failed, not signedOut, when Auth cannot renew the session, and asks the server nothing', async () => {
    const world = setup({ isAuthDown: true })
    expect(await world.service.read(SERVER_ID)).toEqual(
      viewOf({ state: ACCOUNT_STATES.failed, email: null }),
    )
    expect(world.events).toEqual([EVENTS.stateOf])
    expect(world.ended).toEqual([])
  })

  it('is signedOut without asking the server when ready and there is no session', async () => {
    const world = setup({ token: null })
    expect(await world.service.read(SERVER_ID)).toEqual(
      viewOf({ state: ACCOUNT_STATES.signedOut, email: null }),
    )
    expect(world.events).not.toContain(CALL_NAMES.getMe)
  })

  it.each([
    [MEMBER_STATUSES.approved, ACCOUNT_STATES.approved],
    [MEMBER_STATUSES.pending, ACCOUNT_STATES.pending],
    [MEMBER_STATUSES.revoked, ACCOUNT_STATES.revoked],
  ])('narrows an account that is %s to %s', async (status, state) => {
    const world = setup({ me: accountBody({ status }) })
    expect(await world.service.read(SERVER_ID)).toEqual(viewOf({ state }))
    expect(world.events).toEqual([EVENTS.stateOf, CALL_NAMES.getMe])
  })

  it('carries whether the sign-in is remembered', async () => {
    const world = setup({ isRemembered: false })
    expect(await world.service.read(SERVER_ID)).toEqual(viewOf({ isRemembered: false }))
  })

  it('is signedOut for a 401 from /api/me', async () => {
    const world = setup({ me: { ok: true, status: 401, body: '' } })
    expect(await world.service.read(SERVER_ID)).toEqual(
      viewOf({ state: ACCOUNT_STATES.signedOut, email: null }),
    )
  })

  it('is failed for a 503, and keeps the session', async () => {
    const world = setup({ me: { ok: true, status: 503, body: '' } })
    expect((await world.service.read(SERVER_ID)).state).toBe(ACCOUNT_STATES.failed)
    expect(world.events).not.toContain(EVENTS.signOut)
    expect(world.events).not.toContain(EVENTS.forget)
    expect(world.current.token).toBe(TOKEN)
    expect(world.ended).toEqual([])
  })

  it('is failed when the server cannot be reached, and keeps the session', async () => {
    const world = setup({ me: { ok: false, message: 'raven player could not reach Vhagar.' } })
    expect((await world.service.read(SERVER_ID)).state).toBe(ACCOUNT_STATES.failed)
    expect(world.current.token).toBe(TOKEN)
    expect(world.ended).toEqual([])
  })

  it.each([
    ['a 500', { ok: true, status: 500, body: '' }],
    ['an account of a shape it does not know', { ok: true, status: 200, body: '{"id":1}' }],
    ['a reply that is not JSON', { ok: true, status: 200, body: 'nope' }],
    ['an account with a status it does not know', accountBody({ status: 'banned' })],
  ] as const)('is failed for %s', async (_name, me) => {
    const world = setup({ me })
    expect((await world.service.read(SERVER_ID)).state).toBe(ACCOUNT_STATES.failed)
  })

  it('names the sign-in host a ready server pinned, and nothing else about it', async () => {
    const world = setup()
    const view = await world.service.read(SERVER_ID)
    expect(view.signInHost).toBe('project.supabase.co')
    expect(Object.keys(view).toSorted()).toEqual(
      ['email', 'isRemembered', 'serverId', 'signInHost', 'state'].toSorted(),
    )
  })

  it('never hands the page a token, a Supabase address or a key, whatever the state', async () => {
    const states: Setup[] = [
      {},
      { token: null },
      { me: accountBody({ status: MEMBER_STATUSES.pending }) },
      { me: { ok: true, status: 503, body: '' } },
      { me: { ok: true, status: 401, body: '' } },
      { states: [{ kind: AUTH_STATES.off }] },
      { states: [{ kind: AUTH_STATES.unavailable }] },
    ]
    const replies = await Promise.all(
      states.map(async (given) => {
        const world = setup(given)
        const read = await world.service.read(SERVER_ID)
        const refreshed = await world.service.refresh(SERVER_ID)
        const signedOut = await world.service.signOut(SERVER_ID)
        return JSON.stringify({ read, refreshed, signedOut, emitted: world.emitted })
      }),
    )
    replies.forEach((text) => {
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(KEY)
      expect(text).not.toContain(SUPABASE)
      expect(text).not.toContain(PASSWORD)
    })
  })
})

describe('createAccountService refresh', () => {
  it('reads the server config again, then the account from what it read', async () => {
    const world = setup({ rereads: [READY] })
    expect(await world.service.refresh(SERVER_ID)).toEqual(viewOf({}))
    expect(world.events).toEqual([EVENTS.reread, CALL_NAMES.getMe])
  })

  it('shows a server whose accounts went away since', async () => {
    const world = setup({ rereads: [{ kind: AUTH_STATES.off }] })
    expect((await world.service.refresh(SERVER_ID)).state).toBe(ACCOUNT_STATES.off)
  })
})

describe('createAccountService signIn', () => {
  it('reads the server config first and sends the password only to a ready server', async () => {
    const world = setup({ rereads: [READY], token: null })
    const result = await world.service.signIn({
      serverId: SERVER_ID,
      email: EMAIL,
      password: PASSWORD,
    })
    expect(result).toEqual({ ok: true, account: viewOf({}) })
    expect(world.events.slice(0, 2)).toEqual([EVENTS.reread, EVENTS.signIn])
  })

  it('signs in at the endpoints the read vouched for, even when the kept config differs', async () => {
    const moved: SignInConfig = { ...PIN, supabaseUrl: 'https://moved.supabase.co' }
    const world = setup({ rereads: [{ kind: AUTH_STATES.ready, signIn: moved }], token: null })
    await world.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(world.signedInWith).toEqual([moved])
  })

  it.each([
    AUTH_STATES.off,
    AUTH_STATES.legacy,
    AUTH_STATES.down,
    AUTH_STATES.unavailable,
    AUTH_STATES.unreachable,
  ])('sends no password when the server reads %s', async (kind) => {
    const world = setup({ rereads: [{ kind }], states: [{ kind }] })
    const result = await world.service.signIn({
      serverId: SERVER_ID,
      email: EMAIL,
      password: PASSWORD,
    })
    expect(result.ok).toBe(false)
    expect(world.events).toEqual([EVENTS.reread])
  })

  it('names the server when its sign-in settings cannot be read', async () => {
    const world = setup({ rereads: [{ kind: AUTH_STATES.unreachable }] })
    const result = await world.service.signIn({
      serverId: SERVER_ID,
      email: EMAIL,
      password: PASSWORD,
    })
    expect(result).toEqual({ ok: false, message: signInUnavailable({ name: NAME }) })
    expect(result.ok === false && result.message).toBe(
      `${NAME} could not sign you in right now. Try again.`,
    )
  })

  it('logs that it signed in to the server by name, and never the email or the password', async () => {
    const world = setup({ rereads: [READY] })
    await world.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(world.infos).toEqual([`signed in to ${NAME}`])
    const logged = [...world.infos, ...world.warnings].join('\n')
    expect(logged).not.toContain(EMAIL)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(TOKEN)
  })

  it.each([
    [SIGN_IN_OUTCOMES.wrongPassword, ACCOUNT_MESSAGES.wrongPassword],
    [SIGN_IN_OUTCOMES.unconfirmed, ACCOUNT_MESSAGES.unconfirmed],
    [SIGN_IN_OUTCOMES.rateLimited, ACCOUNT_MESSAGES.rateLimited],
    [SIGN_IN_OUTCOMES.unavailable, signInUnavailable({ name: NAME })],
  ])('answers a %s outcome with its message and logs only the kind', async (outcome, message) => {
    const world = setup({ rereads: [READY], outcome, token: null })
    const result = await world.service.signIn({
      serverId: SERVER_ID,
      email: EMAIL,
      password: PASSWORD,
    })
    expect(result).toEqual({ ok: false, message })
    expect(world.infos).toEqual([`could not sign in to ${NAME}: ${outcome}`])
    expect(world.infos.join()).not.toContain(EMAIL)
    expect(world.ended).toEqual([])
  })

  it('shows a pending account as pending', async () => {
    const world = setup({
      rereads: [READY],
      token: null,
      me: accountBody({ status: MEMBER_STATUSES.pending }),
    })
    const result = await world.service.signIn({
      serverId: SERVER_ID,
      email: EMAIL,
      password: PASSWORD,
    })
    expect(result).toEqual({ ok: true, account: viewOf({ state: ACCOUNT_STATES.pending }) })
  })
})

describe('createAccountService signOut', () => {
  it('ends the session, tells the listeners and logs the server by name', async () => {
    const world = setup()
    const view = await world.service.signOut(SERVER_ID)
    expect(world.events).toContain(EVENTS.signOut)
    expect(view).toEqual(viewOf({ state: ACCOUNT_STATES.signedOut, email: null }))
    expect(world.ended).toEqual([SERVER_ID])
    expect(world.infos).toEqual([`signed out of ${NAME}`])
  })

  it('tells the listeners after the session is gone', async () => {
    const world = setup()
    const signedOutChecks: boolean[] = []
    world.accessEnds.listen(() => {
      signedOutChecks.push(world.current.token === null)
    })
    await world.service.signOut(SERVER_ID)
    expect(signedOutChecks).toEqual([true])
  })
})

describe('createAccountService when the account signed in changes', () => {
  it('tells main once a sign out has ended the session', async () => {
    const world = setup()
    await world.service.signOut(SERVER_ID)
    expect(world.switched).toEqual([{ serverId: SERVER_ID, accountId: null }])
  })

  it('tells main when the server rejected the session and signed it out', async () => {
    const world = setup({ me: { ok: true, status: 401, body: '' } })
    await world.service.refused({ serverId: SERVER_ID, isSessionRejected: true })
    expect(world.switched).toEqual([{ serverId: SERVER_ID, accountId: null }])
  })

  it('tells main of a sign in as another account, or after no one was signed in', async () => {
    const other = setup({ signInAs: ACCOUNT_B })
    await other.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(other.switched).toEqual([{ serverId: SERVER_ID, accountId: ACCOUNT_B }])
    const first = setup({ accountId: null, token: null })
    await first.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(first.switched).toEqual([{ serverId: SERVER_ID, accountId: ACCOUNT_A }])
  })

  it('tells main of the same account signing in again once a moved sign-in host dropped its session', async () => {
    const world = setup({ isSessionDroppedOnReread: true })
    await world.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(world.switched).toEqual([{ serverId: SERVER_ID, accountId: ACCOUNT_A }])
  })

  it('tells nobody of a sign in as the account already signed in, nor of one that failed', async () => {
    const same = setup()
    await same.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(same.switched).toEqual([])
    const failed = setup({ accountId: null, outcome: SIGN_IN_OUTCOMES.wrongPassword })
    await failed.service.signIn({ serverId: SERVER_ID, email: EMAIL, password: PASSWORD })
    expect(failed.switched).toEqual([])
  })
})

describe('createAccountService removed', () => {
  it('forgets the sign-in and tells the listeners', async () => {
    const world = setup()
    await world.service.removed(SERVER_ID)
    expect(world.events).toContain(EVENTS.forget)
    expect(world.ended).toEqual([SERVER_ID])
  })
})

describe('createAccountService openPage', () => {
  it.each([
    [ACCOUNT_PAGES.signUp, AUTH_ROUTES.signUp],
    [ACCOUNT_PAGES.forgot, AUTH_ROUTES.forgot],
  ])('opens the %s page on the pinned web origin', async (page, route) => {
    const world = setup()
    expect(await world.service.openPage({ serverId: SERVER_ID, page })).toEqual({ ok: true })
    expect(world.opened).toEqual([`${PIN.webUrl}${route}`])
  })

  it('refuses a server with no pinned sign-in', async () => {
    const world = setup({ pin: null })
    expect(
      await world.service.openPage({ serverId: SERVER_ID, page: ACCOUNT_PAGES.signUp }),
    ).toEqual({ ok: false, message: ACCOUNT_MESSAGES.noPage })
    expect(world.opened).toEqual([])
  })

  it('refuses a server it does not keep', async () => {
    const world = setup()
    expect(
      await world.service.openPage({
        serverId: '00000000-0000-4000-8000-0000000000ff',
        page: ACCOUNT_PAGES.signUp,
      }),
    ).toEqual({ ok: false, message: SERVER_GONE })
  })

  it('answers noBrowser when the browser will not open', async () => {
    const world = setup({ isBrowserBroken: true })
    expect(
      await world.service.openPage({ serverId: SERVER_ID, page: ACCOUNT_PAGES.forgot }),
    ).toEqual({ ok: false, message: ACCOUNT_MESSAGES.noBrowser })
    expect(world.warnings).toHaveLength(1)
  })
})

describe('createAccountService changed', () => {
  it('emits the view once, and again only when it changes', async () => {
    const world = setup()
    await world.service.changed(SERVER_ID)
    await world.service.changed(SERVER_ID)
    expect(world.emitted).toEqual([viewOf({})])
    world.current.me = accountBody({ status: MEMBER_STATUSES.revoked })
    await world.service.changed(SERVER_ID)
    expect(world.emitted).toEqual([viewOf({}), viewOf({ state: ACCOUNT_STATES.revoked })])
  })

  it('does not emit what a read has just shown the page', async () => {
    const world = setup()
    await world.service.read(SERVER_ID)
    await world.service.changed(SERVER_ID)
    expect(world.emitted).toEqual([])
  })
})

describe('createAccountService refused', () => {
  it('signs out of a session the server rejected even with a fresh token, tells the listeners and emits', async () => {
    const world = setup({ me: { ok: true, status: 401, body: '' } })
    await world.service.refused({
      serverId: SERVER_ID,
      isSessionRejected: true,
    })
    expect(world.events).toContain(EVENTS.signOut)
    expect(world.ended).toEqual([SERVER_ID])
    expect(world.infos).toEqual([`signed out of ${NAME}`])
    expect(world.emitted.map(({ state }) => state)).toEqual([ACCOUNT_STATES.signedOut])
  })

  it('keeps the session when the refresh merely failed, and reads the config and the account again', async () => {
    const world = setup({ rereads: [READY] })
    await world.service.refused({
      serverId: SERVER_ID,
      isSessionRejected: false,
    })
    expect(world.events).toEqual([EVENTS.recheck, CALL_NAMES.getMe])
    expect(world.ended).toEqual([])
    expect(world.current.token).toBe(TOKEN)
  })

  it('shows accounts that went down after a 503', async () => {
    const world = setup({ rereads: [{ kind: AUTH_STATES.down }] })
    await world.service.refused({
      serverId: SERVER_ID,
      isSessionRejected: false,
    })
    expect(world.emitted.map(({ state }) => state)).toEqual([ACCOUNT_STATES.unavailable])
  })

  it('shows accounts that turned on since the server was read', async () => {
    const world = setup({
      states: [{ kind: AUTH_STATES.off }],
      rereads: [READY],
      token: null,
    })
    await world.service.refused({
      serverId: SERVER_ID,
      isSessionRejected: false,
    })
    expect(world.emitted.map(({ state }) => state)).toEqual([ACCOUNT_STATES.signedOut])
  })

  it('does not start a second pass for a server whose first is still out', async () => {
    const world = setup({ rereads: [READY, READY] })
    const input = {
      serverId: SERVER_ID,
      isSessionRejected: false,
    } as const
    await Promise.all([world.service.refused(input), world.service.refused(input)])
    expect(world.events.filter((event) => event === EVENTS.recheck)).toHaveLength(1)
  })
})

describe('authorizeWith', () => {
  const withKept = ({
    ready,
    token,
    isAuthDown = false,
  }: {
    ready: SignInConfig | null
    token: string | null
    isAuthDown?: boolean
  }) => {
    const asked: string[] = []
    const authorize = authorizeWith({
      authConfigs: {
        readyOf: (serverId) => {
          asked.push(`readyOf ${serverId}`)
          return ready
        },
      },
      sessions: {
        accessToken: async ({ serverId }) => {
          asked.push(`accessToken ${serverId}`)
          return tokenReadOf({ token, isAuthDown })
        },
      },
    })
    return { authorize, asked }
  }

  it('gives the access token of a server kept as ready', async () => {
    const { authorize, asked } = withKept({ ready: PIN, token: TOKEN })
    expect(await authorize({ serverId: SERVER_ID })).toBe(TOKEN)
    expect(asked).toEqual([`readyOf ${SERVER_ID}`, `accessToken ${SERVER_ID}`])
  })

  it('gives null for a ready server with no session', async () => {
    const { authorize } = withKept({ ready: PIN, token: null })
    expect(await authorize({ serverId: SERVER_ID })).toBeNull()
  })

  it('gives null for a ready server whose Auth cannot renew a token that ran out', async () => {
    const { authorize } = withKept({ ready: PIN, token: TOKEN, isAuthDown: true })
    expect(await authorize({ serverId: SERVER_ID })).toBeNull()
  })

  it('gives null, and asks for no token, for a server not kept as ready: off, legacy or never read', async () => {
    const { authorize, asked } = withKept({ ready: null, token: TOKEN })
    expect(await authorize({ serverId: SERVER_ID })).toBeNull()
    expect(asked).toEqual([`readyOf ${SERVER_ID}`])
  })
})
