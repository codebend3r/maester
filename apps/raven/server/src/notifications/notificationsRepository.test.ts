import { NOTIFICATIONS_KEPT, NOTIFICATION_MESSAGE_MOST, NOTIFICATION_TONES } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseService } from '@/db/database'
import { NotificationsRepository } from '@/notifications/notificationsRepository'
import { testDatabase } from '@/test/database'
import { planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { TEST_ACCOUNTS } from '@/test/repositories'

const someone = TEST_ACCOUNTS.a
const another = TEST_ACCOUNTS.b

const second = (n: number): Date => new Date(Date.UTC(2026, 10, 8, 12, 0, n))

describe('NotificationsRepository', () => {
  const database = testDatabase('raven-notifications-')

  beforeEach(() => database.open())
  afterEach(() => database.close())

  it("keeps each account's notifications to itself, newest first", () => {
    const log = new NotificationsRepository(database.get())
    log.add({ account: someone, message: 'First', tone: NOTIFICATION_TONES.info, at: second(0) })
    log.add({ account: another, message: 'Theirs', tone: NOTIFICATION_TONES.failure })
    log.add({
      account: someone,
      message: 'Second',
      tone: NOTIFICATION_TONES.success,
      at: second(1),
    })
    expect(log.list(someone)).toEqual([
      expect.objectContaining({
        message: 'Second',
        tone: NOTIFICATION_TONES.success,
        at: second(1).toISOString(),
      }),
      expect.objectContaining({ message: 'First', tone: NOTIFICATION_TONES.info }),
    ])
    expect(log.list(another).map(({ message }) => message)).toEqual(['Theirs'])
  })

  it("keeps the newest of an account's notifications, and cuts a long message", () => {
    const log = new NotificationsRepository(database.get())
    Array.from({ length: NOTIFICATIONS_KEPT + 2 }, (_, n) =>
      log.add({ account: someone, message: `Note ${n}`, tone: NOTIFICATION_TONES.info }),
    )
    log.add({
      account: another,
      message: 'x'.repeat(NOTIFICATION_MESSAGE_MOST + 9),
      tone: NOTIFICATION_TONES.info,
    })
    const kept = log.list(someone)
    expect(kept).toHaveLength(NOTIFICATIONS_KEPT)
    expect(kept[0]?.message).toBe(`Note ${NOTIFICATIONS_KEPT + 1}`)
    expect(kept.at(-1)?.message).toBe('Note 2')
    expect(log.list(another)[0]?.message).toHaveLength(NOTIFICATION_MESSAGE_MOST)
  })
})

type ReadProps = { database: DatabaseService }

const STATEMENTS = {
  'an account’s log': ({ database }: ReadProps) =>
    new NotificationsRepository(database).list(another),
  'a notification logged': ({ database }: ReadProps) =>
    new NotificationsRepository(database).add({
      account: another,
      message: 'Logged',
      tone: NOTIFICATION_TONES.info,
    }),
} as const

/** A step over the notifications, by its name. */
const NOTIFICATIONS_STEP = /^[A-Z-]+ notifications\b/

/** Notifications found by the account's index, never every one. */
const BY_KEY = /^SEARCH notifications USING (COVERING )?INDEX notifications_account \(account_id=\?/

describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: 'many accounts’ statistics', prepare: planLikeProduction },
])('how the notifications are read, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-notification-plans-')

  beforeEach(async () => {
    await database.open()
    new NotificationsRepository(database.get()).add({
      account: another,
      message: 'Seeded',
      tone: NOTIFICATION_TONES.info,
    })
    prepare(database.get())
  })

  afterEach(() => database.close())

  it.each(Object.entries(STATEMENTS))('reads %s by key, never every entry', (_name, read) => {
    const traced = tracedDatabase(database.get())
    try {
      read({ database: traced.database })
      const steps = traced.steps().map((step) => step.detail)
      const reads = steps.filter((detail) => NOTIFICATIONS_STEP.test(detail))
      expect(reads).not.toEqual([])
      expect(reads.filter((detail) => !BY_KEY.test(detail))).toEqual([])
      expect(steps.filter((detail) => detail.includes('TEMP B-TREE FOR ORDER BY'))).toEqual([])
    } finally {
      traced.database.onModuleDestroy()
    }
  })
})
