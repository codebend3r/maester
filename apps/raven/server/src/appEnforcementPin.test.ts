import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTH_HEADERS,
  AUTH_REFUSALS,
  LIBRARY_KINDS,
  LOCKED_STATUS,
  SERVER_COOKIES,
  isLibrary,
  isLockState,
} from '@raven/core'
import { HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MediaTickets } from '@/media/mediaTickets'
import { cookieSet } from '@/test/app'
import { AUTH_TEST_IDS, authFixture } from '@/test/auth'
import {
  CALLER_KINDS,
  ROUTES,
  TOKEN_CARRIERS,
  createEnforcedApp,
  headersFor,
  outcomeOf,
  pathOf,
  withTicket,
} from '@/test/enforced'

let fixture: Awaited<ReturnType<typeof authFixture>>

beforeAll(async () => {
  fixture = await authFixture()
})

describe('the library PIN bound to the account', () => {
  const PIN = '3001'
  const WRONG_PIN = '0000'

  let locked: Awaited<ReturnType<typeof createEnforcedApp>>
  let lockedRoot: string

  beforeAll(async () => {
    lockedRoot = await mkdtemp(join(tmpdir(), 'raven-enforcement-pin-'))
    locked = await createEnforcedApp({ root: lockedRoot, fixture, libraryPin: PIN })
    await locked.ownerApi.updateLibrary({
      id: locked.ids.library,
      input: {
        name: 'Enforced',
        paths: [locked.mediaDir],
        settings: { kind: LIBRARY_KINDS.movies, locked: true },
      },
    })
  })

  afterAll(async () => {
    await locked.app.close()
    await rm(lockedRoot, { recursive: true, force: true, maxRetries: 5 })
  })

  const asMember = () =>
    headersFor({ fixture, caller: CALLER_KINDS.member, via: TOKEN_CARRIERS.bearer })
  const asOwner = () =>
    headersFor({ fixture, caller: CALLER_KINDS.owner, via: TOKEN_CARRIERS.bearer })

  const file = ({ headers }: { headers: Record<string, string> }) =>
    locked.app.inject({
      url: pathOf({ route: ROUTES.file, params: { id: locked.ids.video } }),
      headers,
    })

  const unlockWith = ({ headers, pin = PIN }: { headers: Record<string, string>; pin?: string }) =>
    locked.app.inject({
      method: ROUTES.unlock.method,
      url: ROUTES.unlock.path,
      headers,
      payload: { pin },
    })

  const libraryIdsSeenBy = async ({
    headers,
  }: {
    headers: Record<string, string>
  }): Promise<number[]> => {
    const body: unknown = (await locked.app.inject({ url: ROUTES.libraries.path, headers })).json()
    return Array.isArray(body) ? body.filter(isLibrary).map(({ id }) => id) : []
  }

  /** The unlock cookie the owner earns by entering the PIN, as a browser keeps it. */
  const ownerUnlockCookie = async (): Promise<string> => {
    const response = await unlockWith({ headers: await asOwner() })
    expect(response.statusCode).toBe(200)
    return cookieSet(response)
  }

  it('shuts a locked video to the owner until the PIN is entered, then opens it', async () => {
    const headers = await asOwner()
    expect((await file({ headers })).statusCode).toBe(LOCKED_STATUS)
    const unlocking = await unlockWith({ headers })
    expect(unlocking.statusCode).toBe(200)
    expect(String(unlocking.headers[HEADERS.setCookie])).toContain(`${SERVER_COOKIES.unlock}=`)
    const cookie = cookieSet(unlocking)
    expect(
      (await file({ headers: { ...headers, [AUTH_HEADERS.cookie]: cookie } })).statusCode,
    ).toBe(200)
    expect(await libraryIdsSeenBy({ headers })).toEqual([locked.ids.library])
  })

  it("hides the library from a member, even one who sends the owner's unlock cookie", async () => {
    const cookie = await ownerUnlockCookie()
    const member = await asMember()
    const withCookie = { ...member, [AUTH_HEADERS.cookie]: cookie }
    const headers = [member, withCookie]
    const files = await Promise.all(
      headers.map(async (sent) => (await file({ headers: sent })).statusCode),
    )
    expect(files).toEqual([404, 404])
    expect(await Promise.all(headers.map((sent) => libraryIdsSeenBy({ headers: sent })))).toEqual([
      [],
      [],
    ])
    const media = await locked.app.inject({
      url: pathOf({ route: ROUTES.libraryMedia, params: { id: locked.ids.library } }),
      headers: withCookie,
    })
    expect(media.statusCode).toBe(404)
  })

  it('refuses a member the unlock with 403 not_owner and sets no cookie', async () => {
    const headers = await asMember()
    const refusals = await Promise.all(
      [PIN, WRONG_PIN].map(async (pin) => unlockWith({ headers, pin })),
    )
    expect(refusals.map((response) => outcomeOf({ response }).status)).toEqual([403, 403])
    expect(refusals.map((response) => outcomeOf({ response }).reason)).toEqual([
      AUTH_REFUSALS.notOwner,
      AUTH_REFUSALS.notOwner,
    ])
    expect(refusals.map((response) => response.headers[HEADERS.setCookie])).toEqual([
      undefined,
      undefined,
    ])
  })

  it('does not count a member’s unlock among the wrong PINs', async () => {
    const member = await asMember()
    await Promise.all(
      Array.from({ length: 10 }, () => unlockWith({ headers: member, pin: WRONG_PIN })),
    )
    expect((await unlockWith({ headers: await asOwner() })).statusCode).toBe(200)
  })

  it('tells a member the lock is not theirs, and the owner it is', async () => {
    const stateFor = async ({ headers }: { headers: Record<string, string> }) => {
      const body: unknown = (
        await locked.app.inject({ url: ROUTES.lockState.path, headers })
      ).json()
      return isLockState(body) ? body : null
    }
    expect(await stateFor({ headers: await asMember() })).toEqual({
      available: false,
      unlocked: false,
    })
    const owner = await asOwner()
    expect(await stateFor({ headers: owner })).toEqual({ available: true, unlocked: false })
    const cookie = await ownerUnlockCookie()
    const unlocked = { ...owner, [AUTH_HEADERS.cookie]: cookie }
    expect(await stateFor({ headers: unlocked })).toEqual({ available: true, unlocked: true })
    const asMemberWithCookie = { ...(await asMember()), [AUTH_HEADERS.cookie]: cookie }
    expect(await stateFor({ headers: asMemberWithCookie })).toEqual({
      available: false,
      unlocked: false,
    })
  })

  it('reads a cookie from before the account was named as locked', async () => {
    const cookie = await ownerUnlockCookie()
    const [name = '', value = ''] = cookie.split('=')
    const [expires = '', , signature = ''] = value.split('.')
    expect(name).toBe(SERVER_COOKIES.unlock)
    const legacy = `${name}=${expires}.${signature}`
    const headers = { ...(await asOwner()), [AUTH_HEADERS.cookie]: legacy }
    expect((await file({ headers })).statusCode).toBe(LOCKED_STATUS)
  })

  it('reads a cookie whose account was swapped as locked', async () => {
    const cookie = await ownerUnlockCookie()
    const [name = '', value = ''] = cookie.split('=')
    const [expires = '', , signature = ''] = value.split('.')
    const swapped = `${name}=${expires}.${AUTH_TEST_IDS.friend}.${signature}`
    const headers = { ...(await asOwner()), [AUTH_HEADERS.cookie]: swapped }
    expect((await file({ headers })).statusCode).toBe(LOCKED_STATUS)
  })
})

describe('a legacy media ticket beside an account', () => {
  const LEGACY_PIN = '5005'

  let legacy: Awaited<ReturnType<typeof createEnforcedApp>>
  let legacyRoot: string

  beforeAll(async () => {
    legacyRoot = await mkdtemp(join(tmpdir(), 'raven-enforcement-legacy-'))
    legacy = await createEnforcedApp({
      root: legacyRoot,
      fixture,
      libraryPin: LEGACY_PIN,
      mediaSecret: randomBytes(32),
    })
    await legacy.ownerApi.updateLibrary({
      id: legacy.ids.library,
      input: {
        name: 'Enforced',
        paths: [legacy.mediaDir],
        settings: { kind: LIBRARY_KINDS.movies, locked: true },
      },
    })
  })

  afterAll(async () => {
    await legacy.app.close()
    await rm(legacyRoot, { recursive: true, force: true, maxRetries: 5 })
  })

  const fileWithLegacyTicket = async ({ headers }: { headers: Record<string, string> }) => {
    const id = legacy.ids.video
    const { ticket } = legacy.app.get(MediaTickets).issue({ id })
    return legacy.app.inject({
      url: withTicket({ route: ROUTES.file, params: { id }, ticket }),
      headers,
    })
  }

  it("opens a locked library's file to no member, by cookie or Bearer", async () => {
    const statuses = await Promise.all(
      [TOKEN_CARRIERS.cookie, TOKEN_CARRIERS.bearer].map(async (via) => {
        const headers = await headersFor({ fixture, caller: CALLER_KINDS.member, via })
        return (await fileWithLegacyTicket({ headers })).statusCode
      }),
    )
    expect(statuses).toEqual([404, 404])
  })

  it('opens it to the owner no more than the PIN does', async () => {
    const headers = await headersFor({
      fixture,
      caller: CALLER_KINDS.owner,
      via: TOKEN_CARRIERS.bearer,
    })
    expect((await fileWithLegacyTicket({ headers })).statusCode).toBe(LOCKED_STATUS)
  })
})
