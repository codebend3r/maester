import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_PARAMS,
  AUTH_PATHS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  isAccount,
  isAuthConfig,
  isAuthRefusal,
  isMediaTicket,
  isRecord,
  isString,
  MEDIA_TICKET_PARAM,
  MEMBER_STATUSES,
} from '@raven/core'
import {
  ACCOUNT_TICKET_PREFIX,
  AUTH_V1,
  AUTH_V1_PREFIX,
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_KINDS,
  FIXTURE_PUBLISHABLE_KEY,
  type FixtureAccounts,
  GRANT_PARAM,
  GRANTS,
  MAX_ACCOUNT_TICKETS,
} from '@/e2e/fixtureAuth'
import {
  FIXTURE_ADMIN_KINDS,
  FIXTURE_MEDIA,
  type FixtureServer,
  MEDIA_PATHS,
  startFixtureServer,
} from '@/e2e/fixtureServer'
import { API_PATHS } from '@/main/servers/allowlist'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { SERVER_METHODS } from '@/shared/protocol'

const PIN = '3001'
const TICKET_MS = 60_000
const JWT_SECONDS = 3600
const READY = {
  kind: FIXTURE_ACCOUNT_KINDS.ready,
  status: MEMBER_STATUSES.approved,
  ticketMs: TICKET_MS,
  jwtSeconds: JWT_SECONDS,
} as const satisfies FixtureAccounts
const JSON_HEADERS = { [HTTP_HEADERS.contentType]: 'application/json' }

let folder = ''
let clock = 1_800_000_000_000
let fixture: FixtureServer | null = null

const start = async ({ accounts }: { accounts: FixtureAccounts }) => {
  const clip = join(folder, 'clip.mkv')
  await writeFile(clip, Buffer.alloc(256, 7))
  const started = await startFixtureServer({
    clips: { first: clip, second: clip, tracks: clip },
    mode: { pin: PIN, isLocked: true, admin: { kind: FIXTURE_ADMIN_KINDS.off }, accounts },
    now: () => clock,
  })
  fixture = started
  return started
}

const bearer = (token: string) => ({ [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` })

const jsonOf = async (response: Response): Promise<unknown> => response.json()

const grant = ({
  server,
  kind,
  body,
}: {
  server: FixtureServer
  kind: string
  body: Record<string, string>
}) =>
  fetch(`${server.origin}${AUTH_V1.token}?${GRANT_PARAM}=${kind}`, {
    method: SERVER_METHODS.post,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })

const signIn = async (server: FixtureServer) => {
  const response = await grant({
    server,
    kind: GRANTS.password,
    body: { email: FIXTURE_ACCOUNT.email, password: FIXTURE_ACCOUNT.password },
  })
  const session = await jsonOf(response)
  if (!isRecord(session)) throw new Error('No session')
  const { access_token: access, refresh_token: refresh } = session
  if (!isString(access) || !isString(refresh)) throw new Error('No tokens')
  return { access, refresh }
}

const ticketPathOf = (mediaId: number) =>
  AUTH_PATHS.ticket.replace(`:${AUTH_PARAMS.id}`, String(mediaId))

const logout = ({ server, access }: { server: FixtureServer; access: string }) =>
  fetch(`${server.origin}${AUTH_V1.logout}`, {
    method: SERVER_METHODS.post,
    headers: bearer(access),
  })

// Minting needs the library PIN's unlock; redeeming the ticket does not.
const unlockCookie = async (server: FixtureServer) => {
  const response = await fetch(`${server.origin}${API_PATHS.unlock}`, {
    method: SERVER_METHODS.post,
    headers: JSON_HEADERS,
    body: JSON.stringify({ pin: PIN }),
  })
  return (response.headers.get(HTTP_HEADERS.setCookie) ?? '').split(';')[0] ?? ''
}

const mint = async ({ server, access }: { server: FixtureServer; access: string }) => {
  const response = await fetch(`${server.origin}${ticketPathOf(FIXTURE_MEDIA.first)}`, {
    method: SERVER_METHODS.post,
    headers: { ...bearer(access), [AUTH_HEADERS.cookie]: await unlockCookie(server) },
  })
  return { response, body: await jsonOf(response) }
}

const fileWith = ({
  server,
  ticket,
  mediaId = FIXTURE_MEDIA.first,
}: {
  server: FixtureServer
  ticket: string
  mediaId?: number
}) => fetch(`${server.origin}${MEDIA_PATHS.file(mediaId)}?${MEDIA_TICKET_PARAM}=${ticket}`)

const sidecarWith = ({ server, ticket }: { server: FixtureServer; ticket: string }) =>
  fetch(
    `${server.origin}${MEDIA_PATHS.sidecar(FIXTURE_MEDIA.first)}?${MEDIA_TICKET_PARAM}=${ticket}`,
  )

const ticketOf = async ({ server, access }: { server: FixtureServer; access: string }) => {
  const { body } = await mint({ server, access })
  if (!isMediaTicket(body)) throw new Error('No ticket')
  return body
}

const refusalOf = async (response: Response) => {
  const body = await jsonOf(response)
  if (!isAuthRefusal(body)) throw new Error('Not a refusal')
  return body.reason
}

const NO_ACCESS = 'none'

describe('the fixture server accounts', () => {
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fixture-accounts-'))
    clock = 1_800_000_000_000
  })

  afterEach(async () => {
    await (fixture?.close() ?? Promise.resolve())
    fixture = null
    await rm(folder, { recursive: true, force: true })
  })

  it('names itself in a ready config, answers off, and 404s as a legacy server', async () => {
    const ready = await start({ accounts: READY })
    const config = await jsonOf(await fetch(`${ready.origin}${AUTH_PATHS.config}`))
    expect(isAuthConfig(config)).toBe(true)
    expect(config).toMatchObject({
      state: AUTH_CONFIG_STATES.ready,
      supabaseUrl: ready.origin,
      webUrl: ready.origin,
      publishableKey: FIXTURE_PUBLISHABLE_KEY,
    })
    await ready.close()

    const off = await start({ accounts: { kind: FIXTURE_ACCOUNT_KINDS.off } })
    expect(await jsonOf(await fetch(`${off.origin}${AUTH_PATHS.config}`))).toEqual({
      state: AUTH_CONFIG_STATES.off,
    })
    await off.close()

    const legacy = await start({ accounts: { kind: FIXTURE_ACCOUNT_KINDS.legacy } })
    const missing = await fetch(`${legacy.origin}${AUTH_PATHS.config}`)
    expect(missing.status).toBe(404)
    expect(isRecord(await jsonOf(missing))).toBe(true)
  })

  it('answers a ticket mint 503 unavailable when accounts are off or legacy', async () => {
    const kinds = [FIXTURE_ACCOUNT_KINDS.off, FIXTURE_ACCOUNT_KINDS.legacy] as const
    await kinds.reduce(async (previous, kind) => {
      await previous
      const server = await start({ accounts: { kind } })
      const refused = await mint({ server, access: NO_ACCESS })
      expect(refused.response.status).toBe(503)
      expect(isAuthRefusal(refused.body) && refused.body.reason).toBe(AUTH_REFUSALS.unavailable)
      await server.close()
    }, Promise.resolve())
  })

  it('signs in, refuses a wrong password, and rotates a refresh token once', async () => {
    const server = await start({ accounts: READY })
    const wrong = await grant({
      server,
      kind: GRANTS.password,
      body: { email: FIXTURE_ACCOUNT.email, password: 'nope' },
    })
    expect(wrong.status).toBe(400)
    const { refresh } = await signIn(server)
    const rotated = await grant({ server, kind: GRANTS.refresh, body: { refresh_token: refresh } })
    expect(rotated.status).toBe(200)
    const spent = await grant({ server, kind: GRANTS.refresh, body: { refresh_token: refresh } })
    expect(spent.status).toBe(400)
  })

  it('answers the account from its Bearer and refuses an unknown one', async () => {
    const server = await start({ accounts: READY })
    const { access } = await signIn(server)
    const me = await jsonOf(
      await fetch(`${server.origin}${AUTH_PATHS.me}`, { headers: bearer(access) }),
    )
    expect(isAccount(me)).toBe(true)
    expect(me).toMatchObject({ email: FIXTURE_ACCOUNT.email, status: MEMBER_STATUSES.approved })
    const stranger = await fetch(`${server.origin}${AUTH_PATHS.me}`, { headers: bearer('nope') })
    expect(stranger.status).toBe(401)
    expect(await refusalOf(stranger)).toBe(AUTH_REFUSALS.signedOut)
  })

  it('ends a session on logout, so its refresh token is spent', async () => {
    const server = await start({ accounts: READY })
    const { access, refresh } = await signIn(server)
    expect((await logout({ server, access })).status).toBe(204)
    const refreshed = await grant({
      server,
      kind: GRANTS.refresh,
      body: { refresh_token: refresh },
    })
    expect(refreshed.status).toBe(400)
  })

  it('refuses the account once the JWT that read it has ended', async () => {
    const server = await start({ accounts: READY })
    const { access } = await signIn(server)
    clock += JWT_SECONDS * 1000
    const ended = await fetch(`${server.origin}${AUTH_PATHS.me}`, { headers: bearer(access) })
    expect(ended.status).toBe(401)
    expect(await refusalOf(ended)).toBe(AUTH_REFUSALS.signedOut)
  })

  it('takes a ticket for its own title alone, on the file and the sidecar', async () => {
    const server = await start({ accounts: READY })
    const { access } = await signIn(server)
    const { ticket } = await ticketOf({ server, access })
    expect((await sidecarWith({ server, ticket })).status).toBe(200)
    const other = await fileWith({ server, ticket, mediaId: FIXTURE_MEDIA.second })
    expect(other.status).toBe(401)
    expect(await refusalOf(other)).toBe(AUTH_REFUSALS.signedOut)
  })

  it(`caps live tickets at ${MAX_ACCOUNT_TICKETS} and frees them as they expire`, async () => {
    const server = await start({ accounts: READY })
    const { access } = await signIn(server)
    await Array.from({ length: MAX_ACCOUNT_TICKETS }).reduce(async (previous) => {
      await previous
      expect((await mint({ server, access })).response.status).toBe(200)
    }, Promise.resolve())
    const over = await mint({ server, access })
    expect(over.response.status).toBe(503)
    expect(isAuthRefusal(over.body) && over.body.reason).toBe(AUTH_REFUSALS.unavailable)
    clock += TICKET_MS
    expect((await mint({ server, access })).response.status).toBe(200)
  })

  it('serves a locked title for an account ticket until it expires', async () => {
    const server = await start({ accounts: READY })
    const { access } = await signIn(server)
    const { ticket } = await ticketOf({ server, access })
    expect(ticket.startsWith(ACCOUNT_TICKET_PREFIX)).toBe(true)
    expect((await fileWith({ server, ticket })).status).toBe(200)
    expect((await fileWith({ server, ticket: `${ACCOUNT_TICKET_PREFIX}unknown` })).status).toBe(401)
    clock += TICKET_MS
    const expired = await fileWith({ server, ticket })
    expect(expired.status).toBe(401)
    expect(await refusalOf(expired)).toBe(AUTH_REFUSALS.signedOut)
  })

  it('ends a ticket with the JWT that asked for it when that comes first', async () => {
    const server = await start({ accounts: { ...READY, jwtSeconds: 30 } })
    const { access } = await signIn(server)
    const { expiresAt } = await ticketOf({ server, access })
    expect(expiresAt).toBe(clock + 30_000)
  })

  it('refuses a pending or revoked account its tickets and its files', async () => {
    const server = await start({ accounts: READY })
    const { access } = await signIn(server)
    const { ticket } = await ticketOf({ server, access })
    server.setStatus(MEMBER_STATUSES.pending)
    const waiting = await fileWith({ server, ticket })
    expect(waiting.status).toBe(403)
    expect(await refusalOf(waiting)).toBe(AUTH_REFUSALS.pending)
    server.setStatus(MEMBER_STATUSES.revoked)
    const removed = await mint({ server, access })
    expect(removed.response.status).toBe(403)
    expect(isAuthRefusal(removed.body) && removed.body.reason).toBe(AUTH_REFUSALS.revoked)
    server.setStatus(MEMBER_STATUSES.approved)
    expect((await fileWith({ server, ticket })).status).toBe(200)
  })

  it('logs that a Bearer and an account ticket came, never their values', async () => {
    const server = await start({ accounts: READY })
    const { access, refresh } = await signIn(server)
    const refreshed = await grant({
      server,
      kind: GRANTS.refresh,
      body: { refresh_token: refresh },
    })
    const next = await jsonOf(refreshed)
    const { ticket } = await ticketOf({ server, access })
    await fileWith({ server, ticket })
    await logout({ server, access })
    const logged = JSON.stringify(server.requests)
    const secrets = [
      FIXTURE_ACCOUNT.password,
      access,
      refresh,
      ticket,
      isRecord(next) && isString(next.refresh_token) ? next.refresh_token : null,
    ]
    expect(secrets.every((secret) => isString(secret) && !logged.includes(secret))).toBe(true)
    const minted = server.requests.find(({ path }) => path === ticketPathOf(FIXTURE_MEDIA.first))
    expect(minted).toMatchObject({ hasBearer: true, hasAccountTicket: false })
    const file = server.requests.find(({ path }) => path === MEDIA_PATHS.file(FIXTURE_MEDIA.first))
    expect(file).toMatchObject({ hasBearer: false, hasTicket: true, hasAccountTicket: true })
    expect(server.requests.some(({ path }) => path.startsWith(AUTH_V1_PREFIX))).toBe(true)
    expect(
      server.requests
        .filter(({ path }) => path.startsWith(AUTH_V1_PREFIX))
        .every(({ body }) => body === null),
    ).toBe(true)
  })
})
