import { describe, expect, it } from 'bun:test'
import {
  ACCOUNT_REST_PATH,
  ACCOUNT_TABLES,
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_COOKIE,
  AUTH_PATHS,
  AUTH_SCHEME,
  ENCODER_KINDS,
  type FetchInit,
  type FetchLike,
  HEALTH_STATUSES,
  METADATA_SERVICE_STATES,
  ROUTES,
  type ServerHealth,
} from '@raven/core'
import { HTTP_STATUSES } from '@shared/http'
import { createServerDirectory, DIRECTORY_MESSAGES } from '@/main/servers/serverDirectory'
import { library } from '@/main/test/serverFakes'

const HOME = { id: '00000000-0000-4000-8000-0000000000a1', origin: 'https://home.example' }
const FRIEND_ID = '00000000-0000-4000-8000-0000000000b2'
const FRIEND_ORIGIN = 'https://friend.example:8443'
const SUPABASE = 'https://project.supabase.co'
const TOKEN = 'header.payload.signature'
const BEARER = `${AUTH_SCHEME} ${TOKEN}`
const HEALTH_PATH = ROUTES.getServerHealth.path
const LIBRARIES_PATH = ROUTES.listLibraries.path

type HealthOfProps = { serverId?: string }

const healthOf = ({ serverId }: HealthOfProps = {}): ServerHealth => ({
  status: HEALTH_STATUSES.ok,
  ffmpeg: '7.1',
  tonemap: true,
  encoder: ENCODER_KINDS.software,
  thumbnailsPending: 0,
  metadata: {
    tmdb: METADATA_SERVICE_STATES.ok,
    omdb: METADATA_SERVICE_STATES.off,
    mdblist: METADATA_SERVICE_STATES.off,
    pending: 0,
    error: null,
    lastOk: null,
    ai: METADATA_SERVICE_STATES.off,
    aiRemaining: 0,
    aiPending: 0,
  },
  ...(serverId === undefined ? {} : { serverId }),
})

const READY_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: SUPABASE,
  publishableKey: 'sb_publishable_x',
  webUrl: 'https://raven.example',
  cookieName: AUTH_COOKIE,
}

const ROW = {
  id: '00000000-0000-4000-8000-0000000000c3',
  serverId: FRIEND_ID,
  name: 'Friend',
  origin: FRIEND_ORIGIN,
  addedAt: '2026-11-20T00:00:00Z',
}

type Answer = { status: number; body: unknown }

type WorldProps = {
  /** What each URL answers; one it has no answer for does not answer at all. */
  answers: Record<string, Answer>
  token?: string | null
}

/** A directory over a fetch that answers from `answers`, keeping every request it heard. */
const world = ({ answers, token = TOKEN }: WorldProps) => {
  const heard: { url: string; init: FetchInit | undefined }[] = []
  const fetch: FetchLike = async (url, init) => {
    heard.push({ url, init })
    const answer = answers[url.split('?')[0] ?? '']
    if (answer === undefined) throw new TypeError('fetch failed')
    const text = JSON.stringify(answer.body)
    return {
      ok: answer.status < 300,
      status: answer.status,
      statusText: '',
      text: async () => text,
      json: async () => answer.body,
    }
  }
  const warnings: string[] = []
  const directory = createServerDirectory({
    home: HOME,
    fetch,
    accessToken: () => token,
    warn: (message) => warnings.push(message),
  })
  return { directory, heard, warnings }
}

const LISTED = {
  [`${HOME.origin}${AUTH_PATHS.config}`]: { status: HTTP_STATUSES.ok, body: READY_CONFIG },
  [`${SUPABASE}${ACCOUNT_REST_PATH}${ACCOUNT_TABLES.servers}`]: {
    status: HTTP_STATUSES.ok,
    body: [ROW],
  },
}

describe('createServerDirectory', () => {
  it("confirms one of the account's servers by the origin its list keeps, once its health agrees", async () => {
    const { directory, heard } = world({
      answers: {
        ...LISTED,
        [`${FRIEND_ORIGIN}${HEALTH_PATH}`]: {
          status: HTTP_STATUSES.ok,
          body: healthOf({ serverId: FRIEND_ID }),
        },
      },
    })
    expect(await directory.confirm(FRIEND_ID)).toEqual({
      ok: true,
      server: { id: FRIEND_ID, origin: FRIEND_ORIGIN },
    })
    const listing = heard.find(({ url }) => url.startsWith(SUPABASE))
    expect(listing?.init?.headers?.[AUTH_HEADERS.authorization] ?? null).toBe(BEARER)
    // The health is open: it carries nothing of the account's.
    const health = heard.find(({ url }) => url === `${FRIEND_ORIGIN}${HEALTH_PATH}`)
    expect(health?.init?.headers?.[AUTH_HEADERS.authorization] ?? null).toBeNull()
  })

  it('refuses a server the account does not list, asking nothing of it', async () => {
    const other = '00000000-0000-4000-8000-0000000000d4'
    const { directory, heard } = world({ answers: LISTED })
    expect(await directory.confirm(other)).toEqual({
      ok: false,
      message: DIRECTORY_MESSAGES.unlisted,
    })
    expect(heard.some(({ url }) => url.includes(HEALTH_PATH))).toBe(false)
  })

  it('refuses a listed address that answers as another server, or as one with no id', async () => {
    const asOther = world({
      answers: {
        ...LISTED,
        [`${FRIEND_ORIGIN}${HEALTH_PATH}`]: {
          status: HTTP_STATUSES.ok,
          body: healthOf({ serverId: HOME.id }),
        },
      },
    })
    expect(await asOther.directory.confirm(FRIEND_ID)).toEqual({
      ok: false,
      message: DIRECTORY_MESSAGES.otherServer,
    })
    const asNone = world({
      answers: {
        ...LISTED,
        [`${FRIEND_ORIGIN}${HEALTH_PATH}`]: { status: HTTP_STATUSES.ok, body: healthOf() },
      },
    })
    expect((await asNone.directory.confirm(FRIEND_ID)).ok).toBe(false)
  })

  it('uses a listed server that does not answer, as the account names it', async () => {
    const { directory } = world({ answers: LISTED })
    expect(await directory.confirm(FRIEND_ID)).toEqual({
      ok: true,
      server: { id: FRIEND_ID, origin: FRIEND_ORIGIN },
    })
  })

  it('refuses while signed out, and while the home server keeps no accounts', async () => {
    const signedOut = world({ answers: LISTED, token: null })
    expect(await signedOut.directory.confirm(FRIEND_ID)).toEqual({
      ok: false,
      message: DIRECTORY_MESSAGES.signedOut,
    })
    const off = world({
      answers: {
        [`${HOME.origin}${AUTH_PATHS.config}`]: {
          status: HTTP_STATUSES.ok,
          body: { state: AUTH_CONFIG_STATES.off },
        },
      },
    })
    expect(await off.directory.confirm(FRIEND_ID)).toEqual({
      ok: false,
      message: DIRECTORY_MESSAGES.noAccounts,
    })
  })

  it('refuses an id its folders could not carry without reading anything', async () => {
    const { directory, heard } = world({ answers: LISTED })
    expect((await directory.confirm('../../etc')).ok).toBe(false)
    expect(heard).toEqual([])
  })

  it('says the account could not be read when its database does not answer', async () => {
    const { directory, warnings } = world({
      answers: {
        [`${HOME.origin}${AUTH_PATHS.config}`]: { status: HTTP_STATUSES.ok, body: READY_CONFIG },
      },
    })
    expect(await directory.confirm(FRIEND_ID)).toEqual({
      ok: false,
      message: DIRECTORY_MESSAGES.unreachable,
    })
    expect(warnings).toHaveLength(1)
  })

  it('keeps a confirmed server for the account until it is told to forget', async () => {
    const { directory, heard } = world({ answers: LISTED })
    await directory.confirm(FRIEND_ID)
    const asked = heard.length
    await directory.confirm(FRIEND_ID)
    expect(heard).toHaveLength(asked)
    directory.forget()
    await directory.confirm(FRIEND_ID)
    expect(heard.length).toBeGreaterThan(asked)
  })

  it("reads a server's open health for its id, and nothing for one that does not answer", async () => {
    const { directory } = world({
      answers: {
        [`${FRIEND_ORIGIN}${HEALTH_PATH}`]: {
          status: HTTP_STATUSES.ok,
          body: healthOf({ serverId: FRIEND_ID }),
        },
      },
    })
    expect(await directory.check(FRIEND_ORIGIN)).toEqual({ ok: true, serverId: FRIEND_ID })
    expect(await directory.check('https://down.example')).toEqual({ ok: false })
  })

  it("reads another server's libraries with the page's Bearer, once it is confirmed", async () => {
    const libraries = [library({ id: 3, watchedPercent: 90 })]
    const { directory, heard } = world({
      answers: {
        ...LISTED,
        [`${FRIEND_ORIGIN}${LIBRARIES_PATH}`]: { status: HTTP_STATUSES.ok, body: libraries },
      },
    })
    expect(await directory.librariesOf(FRIEND_ID)).toEqual(libraries)
    const read = heard.find(({ url }) => url === `${FRIEND_ORIGIN}${LIBRARIES_PATH}`)
    expect(read?.init?.headers?.[AUTH_HEADERS.authorization] ?? null).toBe(BEARER)
    expect(await directory.librariesOf('00000000-0000-4000-8000-0000000000d4')).toBeNull()
  })
})
