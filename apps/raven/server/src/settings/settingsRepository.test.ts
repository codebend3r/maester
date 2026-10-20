import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SETTINGS_KEYS, SettingsRepository } from '@/settings/settingsRepository'
import { AUTH_TEST_IDS } from '@/test/auth'
import { testDatabase } from '@/test/database'

describe('the accounts enforcement record', () => {
  const database = testDatabase('raven-settings-record-')
  beforeAll(database.open)
  afterAll(database.close)

  const settings = () => new SettingsRepository(database.get())
  const store = (value: string) =>
    database
      .get()
      .db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTINGS_KEYS.accounts, value)

  it('is absent until marked, keeps the first date, and is forgotten on request', () => {
    expect(settings().accountsEnforcedAt()).toBeNull()
    settings().markAccountsEnforced({ at: new Date('2026-10-19T10:00:00.000Z') })
    settings().markAccountsEnforced({ at: new Date('2026-11-01T10:00:00.000Z') })
    expect(settings().accountsEnforcedAt()).toBe('2026-10-19T10:00:00.000Z')
    settings().forgetAccountsEnforced()
    expect(settings().accountsEnforcedAt()).toBeNull()
  })

  it('still reads as enforced when the stored value is damaged', () => {
    store('{not json')
    expect(settings().accountsEnforcedAt()).not.toBeNull()
    store(JSON.stringify({ enforcedAt: 7 }))
    expect(settings().accountsEnforcedAt()).not.toBeNull()
    settings().forgetAccountsEnforced()
    expect(settings().accountsEnforcedAt()).toBeNull()
  })
})

describe('the owner who adopted the viewing from before accounts', () => {
  const database = testDatabase('raven-settings-viewing-')
  beforeAll(database.open)
  afterAll(database.close)

  const settings = () => new SettingsRepository(database.get())
  const store = (value: string) =>
    database
      .get()
      .db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTINGS_KEYS.viewing, value)

  it('is nobody until recorded, then the owner recorded last', () => {
    expect(settings().viewingOwner()).toBeNull()
    settings().markViewingOwner({ ownerId: AUTH_TEST_IDS.owner, at: new Date(0) })
    expect(settings().viewingOwner()).toBe(AUTH_TEST_IDS.owner)
    settings().markViewingOwner({ ownerId: AUTH_TEST_IDS.friend, at: new Date(1) })
    expect(settings().viewingOwner()).toBe(AUTH_TEST_IDS.friend)
  })

  it('is nobody when the record no longer reads as an account', () => {
    store('{not json')
    expect(settings().viewingOwner()).toBeNull()
    store(JSON.stringify({ ownerId: 'not-an-account', adoptedAt: new Date(0).toISOString() }))
    expect(settings().viewingOwner()).toBeNull()
    store(JSON.stringify({ ownerId: AUTH_TEST_IDS.owner }))
    expect(settings().viewingOwner()).toBeNull()
  })
})
