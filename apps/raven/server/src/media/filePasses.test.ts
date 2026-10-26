import { randomBytes } from 'node:crypto'
import { MEMBER_STATUSES, type Account } from '@raven/core'
import { Subject } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_PASS_MS } from '@/auth/accountPasses'
import { ACCOUNT_TICKET_PREFIX } from '@/auth/accountTickets'
import { AuthSessions } from '@/auth/authSessions'
import { TicketAccesses } from '@/auth/ticketAccesses'
import type { Clock } from '@/clock'
import { HLS_CAPABILITY_PREFIX } from '@/hls/hlsCapability'
import { FILE_PASS_CAP, FILE_PASSES_PER_ACCOUNT, FilePasses } from '@/media/filePasses'
import { AUTH_TEST_IDS } from '@/test/auth'
import { manualClock } from '@/test/clock'

const MEDIA = 7
/** A media in a locked library, beside `MEDIA` in an unlocked one. */
const LOCKED_MEDIA = 8
/** When the unlock the tickets here are minted under lapses: never, within a test. */
const UNLOCKED_UNTIL = Number.MAX_SAFE_INTEGER

const accountOf = (id: string): Account => ({
  id,
  email: `${id}@maester.test`,
  status: MEMBER_STATUSES.approved,
  isOwner: false,
})

const FRIEND = accountOf(AUTH_TEST_IDS.friend)
const GUEST = accountOf(AUTH_TEST_IDS.guest)

const newTicket = (): string => `${ACCOUNT_TICKET_PREFIX}${randomBytes(32).toString('base64url')}`

type SetupProps = { clock?: Clock }

/** File passes over real callers, whose account rechecks are subjects a test ends by hand. */
const setup = ({ clock = manualClock().clock }: SetupProps = {}) => {
  const callers = new AuthSessions(
    async () => {
      throw new Error('No token is verified here')
    },
    { current: async () => null },
  )
  const watched = new Map<object, Subject<void>>()
  type EndedProps = { request: object }

  const rechecks = {
    ended: ({ request }: EndedProps) => {
      const ended = new Subject<void>()
      watched.set(request, ended)
      return ended
    },
  }
  const relocks = new Subject<string>()
  type UnlockNeedOfProps = { mediaId: number }

  const lock = {
    relocks,
    unlockNeedOf:
      ({ mediaId }: UnlockNeedOfProps) =>
      () =>
        mediaId === LOCKED_MEDIA,
  }
  const passes = new FilePasses(clock, new TicketAccesses(callers, rechecks, lock))
  type TicketRequestProps = { account?: Account; unlockedUntil?: number | null }

  /** A request the account gate bound to an account ticket of `account`'s, minted under `unlockedUntil`. */
  const ticketRequest = ({ account = FRIEND, unlockedUntil = null }: TicketRequestProps = {}) => {
    const request = {}
    callers.bindTicket({ request, grant: { account, unlockedUntil } })
    return request
  }
  type HeldProps = { account?: Account; mediaId?: number; unlockedUntil?: number | null }

  /** Holds a fresh ticket of `account`'s on `mediaId`, as its first `file` request does. */
  const held = ({ account = FRIEND, mediaId = MEDIA, unlockedUntil = null }: HeldProps = {}) => {
    const request = ticketRequest({ account, unlockedUntil })
    const ticket = newTicket()
    const told = { isEnded: false }
    passes.hold({ request, ticket, mediaId }).subscribe(() => {
      told.isEnded = true
    })
    return {
      ticket,
      mediaId,
      /** Whether what `hold` answered has told the response the pass ended. */
      hasEnded: () => told.isEnded,
      isOpen: () => passes.grantOf({ ticket, mediaId }) !== null,
      isWatched: () => watched.get(request)?.observed ?? false,
      end: () => {
        const ended = watched.get(request)
        if (ended !== undefined) ended.next()
      },
    }
  }
  return { passes, callers, ticketRequest, held, relocks }
}

describe('the passes account tickets earn on a direct file', () => {
  it('holds a pass only for a request an account ticket opened, and grants what that ticket stood for', () => {
    const { passes, callers, ticketRequest } = setup()
    const ticket = newTicket()
    passes.hold({ request: ticketRequest({ unlockedUntil: 42 }), ticket, mediaId: MEDIA })
    expect(passes.grantOf({ ticket, mediaId: MEDIA })).toEqual({
      account: FRIEND,
      unlockedUntil: 42,
    })

    const bySession = {}
    callers.bindSession({
      request: bySession,
      session: { account: FRIEND, token: 'token', expiresAt: Date.now() + 60_000 },
      isBearer: true,
    })
    const others = [
      { request: bySession, ticket: newTicket() },
      { request: {}, ticket: newTicket() },
      { request: ticketRequest(), ticket: `${HLS_CAPABILITY_PREFIX}${'A'.repeat(43)}` },
      { request: ticketRequest(), ticket: 'legacy-ticket' },
    ]
    others.forEach(({ request, ticket: offered }) =>
      passes.hold({ request, ticket: offered, mediaId: MEDIA }),
    )
    passes.hold({ request: ticketRequest(), ticket: [newTicket()], mediaId: MEDIA })
    passes.hold({ request: ticketRequest(), ticket: undefined, mediaId: MEDIA })

    expect(
      others.map(({ ticket: offered }) => passes.grantOf({ ticket: offered, mediaId: MEDIA })),
    ).toEqual([null, null, null, null])
  })

  it('grants a ticket on its own media alone, and never another ticket', () => {
    const { passes, held } = setup()
    const mine = held()
    expect(passes.grantOf({ ticket: mine.ticket, mediaId: MEDIA + 1 })).toBeNull()
    expect(passes.grantOf({ ticket: newTicket(), mediaId: MEDIA })).toBeNull()
    expect(passes.grantOf({ ticket: `${mine.ticket.slice(0, -1)}_`, mediaId: MEDIA })).toBeNull()
    expect(mine.isOpen()).toBe(true)
  })

  it('keeps the deadline of its first open when the ticket opens its file again', () => {
    const { clock, advance } = manualClock()
    const { passes, ticketRequest } = setup({ clock })
    const ticket = newTicket()
    const request = ticketRequest()
    passes.hold({ request, ticket, mediaId: MEDIA })
    advance(60 * 60 * 1000)
    passes.hold({ request, ticket, mediaId: MEDIA })
    advance(ACCOUNT_PASS_MS - 60 * 60 * 1000 - 1)
    expect(passes.grantOf({ ticket, mediaId: MEDIA })).not.toBeNull()
    advance(1)
    expect(passes.grantOf({ ticket, mediaId: MEDIA })).toBeNull()
  })

  it('forgets a pass at its deadline unasked, and stops watching its account', () => {
    const { clock, advance, pending } = manualClock()
    const { held } = setup({ clock })
    const pass = held()
    advance(ACCOUNT_PASS_MS)
    expect(pass.isWatched()).toBe(false)
    expect(pending()).toBe(0)
    expect(pass.isOpen()).toBe(false)
  })

  it('forgets a pass once its account loses access', () => {
    const { held } = setup()
    const pass = held()
    pass.end()
    expect(pass.isOpen()).toBe(false)
    expect(pass.isWatched()).toBe(false)
  })

  it("lets an account's least recently used pass go past its share, never another account's", () => {
    const { clock, advance } = manualClock()
    const { held } = setup({ clock })
    const theirs = held({ account: GUEST })
    const mine = Array.from({ length: FILE_PASSES_PER_ACCOUNT }, () => {
      advance(1)
      return held()
    })
    const [first, second] = mine
    advance(1)
    // Used again, the first is no longer the one least recently used.
    expect(first?.isOpen() ?? null).toBe(true)
    advance(1)
    const newest = held()

    expect(theirs.isOpen()).toBe(true)
    expect(first?.isOpen() ?? null).toBe(true)
    expect(second?.isOpen() ?? null).toBe(false)
    expect(second?.isWatched() ?? null).toBe(false)
    expect(newest.isOpen()).toBe(true)
    expect(mine.filter((pass) => pass.isOpen())).toHaveLength(FILE_PASSES_PER_ACCOUNT - 1)
  })

  it('lets the least recently used pass of all go once the server holds its cap', () => {
    const { clock, advance } = manualClock()
    const { held } = setup({ clock })
    const accounts = Array.from({ length: FILE_PASS_CAP / FILE_PASSES_PER_ACCOUNT }, (_, n) =>
      accountOf(`account-${n}`),
    )
    const all = accounts.flatMap((account) =>
      Array.from({ length: FILE_PASSES_PER_ACCOUNT }, () => {
        advance(1)
        return held({ account })
      }),
    )
    advance(1)
    const newcomer = held({ account: accountOf('newcomer') })
    const [oldest, ...rest] = all

    expect(oldest?.isOpen() ?? null).toBe(false)
    expect(oldest?.isWatched() ?? null).toBe(false)
    expect(rest.every((pass) => pass.isOpen())).toBe(true)
    expect(newcomer.isOpen()).toBe(true)
  })

  it("forgets every pass of a dropped media's file, and every pass once the server stops", () => {
    const { passes, held } = setup()
    const dropped = held({ mediaId: MEDIA })
    const kept = held({ mediaId: MEDIA + 1 })
    passes.drop({ mediaId: MEDIA })
    expect([dropped.isOpen(), dropped.isWatched()]).toEqual([false, false])
    expect([kept.isOpen(), kept.isWatched()]).toEqual([true, true])
    passes.onModuleDestroy()
    expect([kept.isOpen(), kept.isWatched()]).toEqual([false, false])
  })

  it("ends an account's passes on a locked library as the PIN locks again for it, and no other account's", () => {
    const { held, relocks } = setup()
    const locked = held({ mediaId: LOCKED_MEDIA, unlockedUntil: UNLOCKED_UNTIL })
    const unlocked = held({ mediaId: MEDIA, unlockedUntil: UNLOCKED_UNTIL })
    const theirs = held({ account: GUEST, mediaId: LOCKED_MEDIA, unlockedUntil: UNLOCKED_UNTIL })
    relocks.next(FRIEND.id)

    expect([locked.isOpen(), locked.isWatched()]).toEqual([false, false])
    expect([unlocked.isOpen(), unlocked.isWatched()]).toEqual([true, true])
    expect(theirs.isOpen()).toBe(true)
  })

  it('tells the responses a pass opened as it ends, however it ends, and a caller with no pass never', () => {
    const { clock, advance } = manualClock()
    const { passes, held, relocks, ticketRequest } = setup({ clock })
    const relocked = held({ mediaId: LOCKED_MEDIA, unlockedUntil: UNLOCKED_UNTIL })
    const dropped = held({ mediaId: MEDIA + 1 })
    const removed = held()
    const lapsed = held()
    const request = ticketRequest()
    const ticket = newTicket()
    const ranges = [0, 1].map(() => {
      const range = { isEnded: false }
      passes.hold({ request, ticket, mediaId: MEDIA }).subscribe(() => {
        range.isEnded = true
      })
      return range
    })
    const unpassed = { isEnded: false }
    passes.hold({ request: {}, ticket: newTicket(), mediaId: MEDIA }).subscribe(() => {
      unpassed.isEnded = true
    })

    relocks.next(FRIEND.id)
    passes.drop({ mediaId: MEDIA + 1 })
    removed.end()
    expect([relocked, dropped, removed].map((pass) => pass.hasEnded())).toEqual([true, true, true])
    expect([lapsed.hasEnded(), ...ranges.map((range) => range.isEnded)]).toEqual([
      false,
      false,
      false,
    ])

    advance(ACCOUNT_PASS_MS)
    expect([lapsed.hasEnded(), ...ranges.map((range) => range.isEnded)]).toEqual([true, true, true])
    expect(unpassed.isEnded).toBe(false)
  })
})
