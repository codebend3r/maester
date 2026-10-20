import { ITEM_TYPES, LIBRARY_KINDS } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { type AccountKey, VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { type AdoptedCounts, ViewingAdoption } from '@/media/viewingAdoption'
import { PLAY_KINDS } from '@/media/watchedRepository'
import { localSeason } from '@/metadata/localItems'
import { SETTINGS_KEYS, SettingsRepository } from '@/settings/settingsRepository'
import { AUTH_TEST_IDS } from '@/test/auth'
import { testDatabase } from '@/test/database'
import { repositories, viewingCountsOf } from '@/test/repositories'

const OWNER = AUTH_TEST_IDS.owner
const LOCAL = VIEWING_ACCOUNTS.local

type PlayKind = (typeof PLAY_KINDS)[keyof typeof PLAY_KINDS]

/** Midday UTC on that day of October 2026, as the tables store it. */
const day = (date: number): string => new Date(Date.UTC(2026, 9, date, 12)).toISOString()

const NOTHING = {
  spots: 0,
  plays: 0,
  favourites: 0,
  titleFavourites: 0,
} as const satisfies AdoptedCounts

describe('the owner adopting the viewing from before accounts', () => {
  const database = testDatabase('raven-viewing-adoption-')
  const ids = { first: 0, second: 0, show: 0 }

  const db = () => database.get().db
  const settings = () => new SettingsRepository(database.get())
  const adoption = () => new ViewingAdoption(database.get(), settings())

  const spot = ({
    account,
    mediaId,
    position,
    at,
  }: {
    account: AccountKey
    mediaId: number
    position: number
    at: string
  }) =>
    db()
      .prepare(
        'INSERT INTO playback_progress (account_id, media_id, position, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(account, mediaId, position, at)

  const favourite = ({
    account,
    mediaId,
    at,
  }: {
    account: AccountKey
    mediaId: number
    at: string
  }) =>
    db()
      .prepare('INSERT INTO favourites (account_id, media_id, added_at) VALUES (?, ?, ?)')
      .run(account, mediaId, at)

  const titleFavourite = ({
    account,
    itemId,
    at,
  }: {
    account: AccountKey
    itemId: number
    at: string
  }) =>
    db()
      .prepare('INSERT INTO item_favourites (account_id, item_id, added_at) VALUES (?, ?, ?)')
      .run(account, itemId, at)

  const play = ({
    account,
    mediaId,
    at,
    kind,
  }: {
    account: AccountKey
    mediaId: number
    at: string
    kind: PlayKind
  }) =>
    db()
      .prepare(
        `INSERT INTO plays (account_id, media_id, played_at, furthest, kind)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run(account, mediaId, at, kind)

  /** Every viewing row, in a fixed order, so two reads compare whole. */
  const rows = () => ({
    spots: db()
      .prepare(
        'SELECT account_id, media_id, position, updated_at FROM playback_progress ORDER BY account_id, media_id',
      )
      .all(),
    plays: db()
      .prepare('SELECT id, account_id, media_id, played_at, kind FROM plays ORDER BY id')
      .all(),
    favourites: db()
      .prepare(
        'SELECT account_id, media_id, added_at FROM favourites ORDER BY account_id, media_id',
      )
      .all(),
    titleFavourites: db()
      .prepare(
        'SELECT account_id, item_id, added_at FROM item_favourites ORDER BY account_id, item_id',
      )
      .all(),
  })

  /** How many rows `account` holds in each table. */
  const countsOf = ({ account }: { account: AccountKey }) =>
    viewingCountsOf({ database: database.get(), account })

  /** The stored `viewing` setting, as written. */
  const viewingSetting = () =>
    db()
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEYS.viewing)?.value ?? null

  /** Two videos and a show, and what the one shared viewer did with them before accounts. */
  const recordThePast = () => {
    spot({ account: LOCAL, mediaId: ids.first, position: 30, at: day(1) })
    play({ account: LOCAL, mediaId: ids.first, at: day(1), kind: PLAY_KINDS.played })
    play({ account: LOCAL, mediaId: ids.second, at: day(2), kind: PLAY_KINDS.marked })
    favourite({ account: LOCAL, mediaId: ids.first, at: day(1) })
    titleFavourite({ account: LOCAL, itemId: ids.show, at: day(2) })
  }

  beforeEach(async () => {
    await database.open()
    const libraryId = new LibrariesRepository(database.get()).create({
      name: 'Mixed',
      paths: ['/mixed'],
      settings: { kind: LIBRARY_KINDS.movies },
    }).id
    const index = new MediaIndex(database.get())
    const add = (name: string): number =>
      index.insert({
        libraryId,
        kind: LIBRARY_KINDS.movies,
        file: { path: `/mixed/${name}.mp4`, root: '/mixed', size: 1, mtimeMs: 1 },
      })
    ids.first = add('first')
    ids.second = add('second')
    ids.show = repositories(database.get()).metadata.save({
      item: {
        ...localSeason({ showTmdbId: '1', number: 1 }),
        type: ITEM_TYPES.show,
        tmdbId: '1',
        number: null,
        title: 'Show',
      },
    })
  })

  afterEach(database.close)

  it('gives the owner every row and records them, and finds nothing the second time', () => {
    recordThePast()
    expect(adoption().hasLocalRows()).toBe(true)

    expect(adoption().adopt({ ownerId: OWNER })).toEqual({
      spots: 1,
      plays: 2,
      favourites: 1,
      titleFavourites: 1,
    })
    expect(countsOf({ account: LOCAL })).toEqual(NOTHING)
    expect(countsOf({ account: OWNER })).toEqual({
      spots: 1,
      plays: 2,
      favourites: 1,
      titleFavourites: 1,
    })
    expect(settings().viewingOwner()).toBe(OWNER)
    expect(adoption().hasLocalRows()).toBe(false)

    const adopted = rows()
    const recorded = viewingSetting()
    expect(adoption().adopt({ ownerId: OWNER })).toEqual(NOTHING)
    expect(rows()).toEqual(adopted)
    expect(viewingSetting()).toEqual(recorded)
  })

  it('keeps the newer spot and the earlier favourite where the owner has one too', () => {
    spot({ account: OWNER, mediaId: ids.first, position: 70, at: day(5) })
    spot({ account: LOCAL, mediaId: ids.first, position: 20, at: day(1) })
    spot({ account: OWNER, mediaId: ids.second, position: 10, at: day(1) })
    spot({ account: LOCAL, mediaId: ids.second, position: 40, at: day(5) })
    favourite({ account: OWNER, mediaId: ids.first, at: day(5) })
    favourite({ account: LOCAL, mediaId: ids.first, at: day(1) })
    favourite({ account: OWNER, mediaId: ids.second, at: day(1) })
    favourite({ account: LOCAL, mediaId: ids.second, at: day(5) })
    titleFavourite({ account: OWNER, itemId: ids.show, at: day(5) })
    titleFavourite({ account: LOCAL, itemId: ids.show, at: day(1) })
    play({ account: OWNER, mediaId: ids.first, at: day(5), kind: PLAY_KINDS.played })
    play({ account: LOCAL, mediaId: ids.first, at: day(1), kind: PLAY_KINDS.played })

    adoption().adopt({ ownerId: OWNER })

    expect(rows()).toEqual({
      spots: [
        { account_id: OWNER, media_id: ids.first, position: 70, updated_at: day(5) },
        { account_id: OWNER, media_id: ids.second, position: 40, updated_at: day(5) },
      ],
      plays: [
        expect.objectContaining({ account_id: OWNER, played_at: day(5) }),
        expect.objectContaining({ account_id: OWNER, played_at: day(1) }),
      ],
      favourites: [
        { account_id: OWNER, media_id: ids.first, added_at: day(1) },
        { account_id: OWNER, media_id: ids.second, added_at: day(1) },
      ],
      titleFavourites: [{ account_id: OWNER, item_id: ids.show, added_at: day(1) }],
    })
  })

  it('leaves every row from before accounts, and no owner, when it fails part way', () => {
    recordThePast()
    const before = rows()
    db().exec(
      `CREATE TRIGGER refuse_viewing BEFORE INSERT ON settings
       WHEN NEW.key = '${SETTINGS_KEYS.viewing}'
       BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
    )

    expect(() => adoption().adopt({ ownerId: OWNER })).toThrow()

    expect(rows()).toEqual(before)
    expect(countsOf({ account: OWNER })).toEqual(NOTHING)
    expect(settings().viewingOwner()).toBeNull()
    expect(adoption().hasLocalRows()).toBe(true)
  })

  it.each([
    {
      held: 'a spot',
      record: () => spot({ account: LOCAL, mediaId: ids.first, position: 5, at: day(1) }),
    },
    {
      held: 'a play',
      record: () =>
        play({ account: LOCAL, mediaId: ids.first, at: day(1), kind: PLAY_KINDS.cleared }),
    },
    {
      held: 'a favourite',
      record: () => favourite({ account: LOCAL, mediaId: ids.first, at: day(1) }),
    },
    {
      held: 'a title favourite',
      record: () => titleFavourite({ account: LOCAL, itemId: ids.show, at: day(1) }),
    },
  ])('finds the past when all it holds is $held', ({ record }) => {
    spot({ account: OWNER, mediaId: ids.second, position: 5, at: day(1) })
    expect(adoption().hasLocalRows()).toBe(false)
    record()
    expect(adoption().hasLocalRows()).toBe(true)
  })
})
