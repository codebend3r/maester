import { SCROBBLE_SERVICES } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScrobbleCipher } from '@/scrobbling/scrobbleCipher'
import { ScrobbleLinks } from '@/scrobbling/scrobbleLinks'
import { SettingsRepository } from '@/settings/settingsRepository'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS } from '@/test/repositories'

const TOKEN = 'plain-listenbrainz-token-0001'

describe('ScrobbleLinks', () => {
  const database = testDatabase('raven-scrobble-links-')

  beforeAll(() => database.open())
  afterAll(() => database.close())

  const links = () => {
    const db = database.get()
    return new ScrobbleLinks(db, new ScrobbleCipher(new SettingsRepository(db)))
  }

  it('keeps the token sealed, never its plain text, and opens it for its own account alone', () => {
    const store = links()
    store.save({
      account: TEST_ACCOUNTS.b,
      service: SCROBBLE_SERVICES.listenBrainz,
      username: 'member',
      secret: TOKEN,
      at: new Date('2026-10-31T12:00:00Z'),
    })
    const [row] = database
      .get()
      .db.prepare<[], { secret_cipher: string }>('SELECT secret_cipher FROM scrobble_links')
      .all()
    const sealed = row?.secret_cipher ?? ''
    expect(sealed).not.toContain(TOKEN)
    expect(sealed.split('.')).toHaveLength(3)
    expect(sealed).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/u)

    expect(
      store.secretOf({ account: TEST_ACCOUNTS.b, service: SCROBBLE_SERVICES.listenBrainz }),
    ).toBe(TOKEN)
    expect(
      links().secretOf({ account: TEST_ACCOUNTS.b, service: SCROBBLE_SERVICES.listenBrainz }),
    ).toBe(TOKEN)
    expect(
      store.secretOf({ account: TEST_ACCOUNTS.a, service: SCROBBLE_SERVICES.listenBrainz }),
    ).toBeNull()
    expect(store.list({ account: TEST_ACCOUNTS.a })).toEqual([])
    expect(store.list({ account: TEST_ACCOUNTS.b })).toEqual([
      { service: SCROBBLE_SERVICES.listenBrainz, username: 'member' },
    ])
  })

  it("opens nothing from a sealed token moved onto another account's row", () => {
    const store = links()
    database
      .get()
      .db.prepare(
        `INSERT INTO scrobble_links (account_id, service, username, secret_cipher, created_at)
         SELECT @other, service, username, secret_cipher, created_at FROM scrobble_links
          WHERE account_id = @account`,
      )
      .run({ other: TEST_ACCOUNTS.a, account: TEST_ACCOUNTS.b })
    expect(
      store.secretOf({ account: TEST_ACCOUNTS.a, service: SCROBBLE_SERVICES.listenBrainz }),
    ).toBeNull()
    store.remove({ account: TEST_ACCOUNTS.a, service: SCROBBLE_SERVICES.listenBrainz })
    expect(store.list({ account: TEST_ACCOUNTS.a })).toEqual([])
  })

  it('seals the same token differently each time', () => {
    const cipher = new ScrobbleCipher(new SettingsRepository(database.get()))
    const once = cipher.seal({ plain: TOKEN, context: 'a' })
    expect(cipher.seal({ plain: TOKEN, context: 'a' })).not.toBe(once)
    expect(cipher.open({ sealed: once, context: 'a' })).toBe(TOKEN)
    expect(cipher.open({ sealed: once, context: 'b' })).toBeNull()
    expect(cipher.open({ sealed: 'not.sealed', context: 'a' })).toBeNull()
  })
})
