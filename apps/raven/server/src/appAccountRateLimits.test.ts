import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEADERS, TOO_MANY_REQUESTS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCOUNT_STRICT_LIMIT, RATE_LIMITS, RATE_TIERS } from '@/rateLimits/rateTiers'
import { authFixture } from '@/test/auth'
import {
  CALLER_KINDS,
  ROUTES,
  TOKEN_CARRIERS,
  createEnforcedApp,
  headersFor,
  pathOf,
} from '@/test/enforced'

/** One public address that every caller here shares, as a household or a CGNAT does. */
const SHARED = '198.51.100.77'

const STRICT = RATE_LIMITS[RATE_TIERS.strict]

/** A stranger of its own: the strict tier counts IPv6 by /48, so each `n` is a new client. */
const strangerAt = (n: number): string => `2001:db8:${n.toString(16)}::1`

describe("each account's own budget on the strict routes", () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  let enforced: Awaited<ReturnType<typeof createEnforcedApp>>
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'raven-account-rate-limits-'))
    fixture = await authFixture()
    enforced = await createEnforcedApp({ root, fixture })
  })

  afterAll(async () => {
    await enforced.app.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  })

  type MintProps = { caller: typeof CALLER_KINDS.owner | typeof CALLER_KINDS.member }

  const mint = async ({ caller }: MintProps) =>
    enforced.app.inject({
      method: ROUTES.accountTicket.method,
      url: pathOf({ route: ROUTES.accountTicket, params: { id: enforced.ids.video } }),
      headers: await headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer }),
      remoteAddress: SHARED,
    })

  it('refuses an account past its own budget and leaves another behind the same address be', async () => {
    const statuses = await Array.from({ length: ACCOUNT_STRICT_LIMIT.limit }).reduce<
      Promise<number[]>
    >(
      async (sent) => [...(await sent), (await mint({ caller: CALLER_KINDS.owner })).statusCode],
      Promise.resolve([]),
    )
    expect(statuses.every((status) => status !== TOO_MANY_REQUESTS)).toBe(true)
    const refused = await mint({ caller: CALLER_KINDS.owner })
    expect(refused.statusCode).toBe(TOO_MANY_REQUESTS)
    expect(Number(refused.headers[HEADERS.retryAfter])).toBeGreaterThan(0)
    expect((await mint({ caller: CALLER_KINDS.member })).statusCode).not.toBe(TOO_MANY_REQUESTS)
  })

  // Last, as it fills the tier. The owner spent their own budget above, so the member asks here.
  it('keeps an account in when strangers fill the strict tier, and holds the strangers to one ceiling', async () => {
    const echo = (remoteAddress: string) =>
      enforced.app.inject({
        method: ROUTES.remoteAccessEcho.method,
        url: pathOf({ route: ROUTES.remoteAccessEcho, params: { nonce: 'not-a-nonce' } }),
        remoteAddress,
      })
    // The test above left one client in the tier already: the shared address.
    const sent = Array.from({ length: STRICT.maxKeys - 1 + STRICT.overflowLimit }, (_, n) => n)
    const statuses = await sent.reduce<Promise<number[]>>(
      async (done, n) => [...(await done), (await echo(strangerAt(n))).statusCode],
      Promise.resolve([]),
    )
    expect(statuses.every((status) => status !== TOO_MANY_REQUESTS)).toBe(true)
    const stranger = await echo(strangerAt(sent.length))
    expect(stranger.statusCode).toBe(TOO_MANY_REQUESTS)
    expect(Number(stranger.headers[HEADERS.retryAfter])).toBeGreaterThan(0)
    const member = await enforced.app.inject({
      method: ROUTES.accountTicket.method,
      url: pathOf({ route: ROUTES.accountTicket, params: { id: enforced.ids.video } }),
      headers: await headersFor({
        fixture,
        caller: CALLER_KINDS.member,
        via: TOKEN_CARRIERS.bearer,
      }),
      remoteAddress: strangerAt(sent.length + 1),
    })
    expect(member.statusCode).not.toBe(TOO_MANY_REQUESTS)
  }, 120_000)
})
