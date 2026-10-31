import { LIBRARY_KINDS, SCROBBLE_SERVICES } from '@raven/core'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type LastFmKeys, readServerConfig } from '@/config'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { LastFmScrobbler } from '@/scrobbling/lastFmScrobbler'
import { ListenBrainzScrobbler } from '@/scrobbling/listenBrainzScrobbler'
import { ScrobbleCipher } from '@/scrobbling/scrobbleCipher'
import { ScrobbleLinks } from '@/scrobbling/scrobbleLinks'
import { ScrobbleQueue } from '@/scrobbling/scrobbleQueue'
import {
  SCROBBLE_KEEP_MS,
  SCROBBLE_RETRY_CAP_MS,
  SCROBBLE_RETRY_MS,
  ScrobbleSender,
} from '@/scrobbling/scrobbleSender'
import { SettingsRepository } from '@/settings/settingsRepository'
import { manualClock } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { FAKE_LASTFM_KEYS, fakeLastFm } from '@/test/fakeLastFm'
import { fakeListenBrainz } from '@/test/fakeListenBrainz'
import { musicLibrary } from '@/test/musicLibrary'
import { TEST_ACCOUNTS } from '@/test/repositories'

const NOW = Date.parse('2026-10-31T12:00:00Z')

const MINUTE_MS = 60 * 1000

const LB_TOKEN = 'lb-token-of-member-0001'

const FM_TOKEN = 'fm-sign-in-token-0001'

const account = TEST_ACCOUNTS.b

const other = TEST_ACCOUNTS.a

describe('ScrobbleSender', () => {
  const database = testDatabase('raven-scrobble-sender-')
  const ids = { track: 0, audiobook: 0 }
  const setup = {
    clock: manualClock(),
    listenBrainz: fakeListenBrainz({ users: { [LB_TOKEN]: 'member' } }),
    lastFm: fakeLastFm({ tokens: { [FM_TOKEN]: 'member-fm' } }),
  }

  type WiredProps = { lastFmKeys?: LastFmKeys | null }

  /** Everything the sender is wired with, over the test's database, clock and fakes. */
  const wired = ({ lastFmKeys = FAKE_LASTFM_KEYS }: WiredProps = {}) => {
    const db = database.get()
    const { music } = musicLibrary(db)
    const links = new ScrobbleLinks(db, new ScrobbleCipher(new SettingsRepository(db)))
    const queue = new ScrobbleQueue(db, setup.clock.clock)
    const listenBrainz = new ListenBrainzScrobbler(setup.listenBrainz.fetch, 1000)
    const lastFm = new LastFmScrobbler(
      { ...readServerConfig({}), lastFm: lastFmKeys },
      setup.lastFm.fetch,
    )
    const sender = new ScrobbleSender(queue, links, music, listenBrainz, lastFm, setup.clock.clock)
    return { links, queue, listenBrainz, lastFm, sender }
  }

  const queued = () =>
    database
      .get()
      .db.prepare(
        'SELECT account_id, service, media_id, listened_at, attempts, next_at FROM scrobble_queue ORDER BY service',
      )
      .all()

  beforeEach(async () => {
    await database.open()
    setup.clock = manualClock()
    setup.clock.advance(NOW)
    setup.listenBrainz = fakeListenBrainz({ users: { [LB_TOKEN]: 'member' } })
    setup.lastFm = fakeLastFm({ tokens: { [FM_TOKEN]: 'member-fm' } })
    const db = database.get()
    const { addLibrary, addTrack } = musicLibrary(db)
    ids.track = addTrack({
      libraryId: addLibrary({ name: 'Music' }),
      title: 'Paranoid Android',
      artist: 'Radiohead',
      album: 'OK Computer',
    })
    const books = new LibrariesRepository(db).create({
      name: 'Books',
      paths: ['/books'],
      settings: { kind: LIBRARY_KINDS.audiobooks },
    }).id
    ids.audiobook = new MediaIndex(db).insert({
      libraryId: books,
      kind: LIBRARY_KINDS.audiobooks,
      file: { path: '/books/Dune/Dune.m4b', root: '/books', size: 1, mtimeMs: 1 },
    })
  })

  afterEach(() => database.close())

  /** Links both services for `account`, as the routes do once each has said yes. */
  const linkBoth = async ({ links, lastFm }: ReturnType<typeof wired>) => {
    links.save({
      account,
      service: SCROBBLE_SERVICES.listenBrainz,
      username: 'member',
      secret: LB_TOKEN,
      at: new Date(NOW),
    })
    const session = await lastFm.validate({ token: FM_TOKEN })
    if (session === null) throw new Error('The fake Last.fm refused its own token')
    links.save({ account, service: SCROBBLE_SERVICES.lastFm, at: new Date(NOW), ...session })
  }

  it('queues a music track once per linked service, as begun half the track ago, and an audiobook never', async () => {
    const parts = wired()
    await linkBoth(parts)
    parts.queue.noteListen({
      mediaId: ids.audiobook,
      account,
      services: Object.values(SCROBBLE_SERVICES),
    })
    parts.queue.noteListen({
      mediaId: ids.track,
      account: other,
      services: [SCROBBLE_SERVICES.lastFm],
    })
    expect(queued()).toEqual([])

    parts.queue.noteListen({
      mediaId: ids.track,
      account,
      services: Object.values(SCROBBLE_SERVICES),
    })
    const begun = NOW / 1000 - 100
    expect(queued()).toEqual(
      [SCROBBLE_SERVICES.lastFm, SCROBBLE_SERVICES.listenBrainz].map((service) => ({
        account_id: account,
        service,
        media_id: ids.track,
        listened_at: begun,
        attempts: 0,
        next_at: NOW,
      })),
    )
  })

  it("posts ListenBrainz's listens JSON and Last.fm's signed scrobble, then forgets them", async () => {
    const parts = wired()
    await linkBoth(parts)
    parts.sender.noteListen({ mediaId: ids.track, account })
    await parts.sender.whenIdle()

    const begun = NOW / 1000 - 100
    expect(setup.listenBrainz.submissions).toEqual([
      {
        token: LB_TOKEN,
        body: {
          listen_type: 'single',
          payload: [
            {
              listened_at: begun,
              track_metadata: {
                artist_name: 'Radiohead',
                track_name: 'Paranoid Android',
                release_name: 'OK Computer',
                additional_info: { duration_ms: 200_000 },
              },
            },
          ],
        },
      },
    ])
    expect(setup.lastFm.scrobbles).toEqual([
      expect.objectContaining({
        method: 'track.scrobble',
        artist: 'Radiohead',
        track: 'Paranoid Android',
        album: 'OK Computer',
        timestamp: String(begun),
        duration: '200',
        sk: `session-of-${FM_TOKEN}`,
      }),
    ])
    expect(queued()).toEqual([])
  })

  it('tries a 503 again after a minute, then two, and gives up on a listen a week old', async () => {
    const parts = wired()
    await linkBoth(parts)
    parts.links.remove({ account, service: SCROBBLE_SERVICES.lastFm })
    setup.listenBrainz.setSubmitStatus({ status: 503 })
    parts.sender.noteListen({ mediaId: ids.track, account })
    await parts.sender.whenIdle()
    expect(queued()).toEqual([
      expect.objectContaining({ attempts: 1, next_at: NOW + SCROBBLE_RETRY_MS }),
    ])

    setup.clock.advance(SCROBBLE_RETRY_MS - 1)
    await parts.sender.whenIdle()
    expect(queued()).toEqual([expect.objectContaining({ attempts: 1 })])

    setup.clock.advance(1)
    await parts.sender.whenIdle()
    expect(queued()).toEqual([
      expect.objectContaining({ attempts: 2, next_at: NOW + 3 * SCROBBLE_RETRY_MS }),
    ])

    setup.listenBrainz.setSubmitStatus({ status: null })
    setup.clock.advance(2 * SCROBBLE_RETRY_MS)
    await parts.sender.whenIdle()
    expect(setup.listenBrainz.submissions).toHaveLength(1)
    expect(queued()).toEqual([])
  })

  it('waits no more than six hours between tries, and drops a listen past seven days', async () => {
    const parts = wired()
    await linkBoth(parts)
    parts.links.remove({ account, service: SCROBBLE_SERVICES.lastFm })
    setup.listenBrainz.setSubmitStatus({ status: 503 })
    parts.sender.noteListen({ mediaId: ids.track, account })
    await parts.sender.whenIdle()
    const waits = await Array.from({ length: 12 }).reduce<Promise<number[]>>(async (before) => {
      const seen = await before
      const [row] = database
        .get()
        .db.prepare<[], { next_at: number }>('SELECT next_at FROM scrobble_queue')
        .all()
      if (row === undefined) return seen
      const wait = row.next_at - setup.clock.clock.now()
      setup.clock.advance(wait)
      await parts.sender.whenIdle()
      return [...seen, wait]
    }, Promise.resolve([]))
    expect(waits.slice(0, 3)).toEqual([MINUTE_MS, 2 * MINUTE_MS, 4 * MINUTE_MS])
    expect(Math.max(...waits)).toBe(SCROBBLE_RETRY_CAP_MS)

    setup.clock.advance(SCROBBLE_KEEP_MS)
    await parts.sender.whenIdle()
    expect(queued()).toEqual([])
  })

  it('drops a listen a week old without sending it', async () => {
    const parts = wired()
    await linkBoth(parts)
    parts.queue.noteListen({
      mediaId: ids.track,
      account,
      services: [SCROBBLE_SERVICES.listenBrainz],
    })
    setup.clock.advance(SCROBBLE_KEEP_MS)
    parts.sender.kick()
    await parts.sender.whenIdle()
    expect(setup.listenBrainz.submissions).toEqual([])
    expect(queued()).toEqual([])
  })

  it('unlinks a service that answers 401, with what was waiting for it', async () => {
    const parts = wired()
    await linkBoth(parts)
    setup.listenBrainz.setSubmitStatus({ status: 401 })
    setup.lastFm.setScrobbleError({ error: 9 })
    parts.sender.noteListen({ mediaId: ids.track, account })
    await parts.sender.whenIdle()
    expect(parts.links.list({ account })).toEqual([])
    expect(queued()).toEqual([])
  })

  it('queues nothing for Last.fm while its keys are unset', async () => {
    const parts = wired()
    await linkBoth(parts)
    const keyless = wired({ lastFmKeys: null })
    expect(keyless.sender.available()).toEqual([SCROBBLE_SERVICES.listenBrainz])
    keyless.queue.noteListen({ mediaId: ids.track, account, services: keyless.sender.available() })
    expect(queued()).toEqual([expect.objectContaining({ service: SCROBBLE_SERVICES.listenBrainz })])
  })

  it('unlinks a service whose stored secret no longer opens, warning, with what was waiting for it', async () => {
    const parts = wired()
    await linkBoth(parts)
    const warned = vi.spyOn(Logger.prototype, 'warn')
    try {
      database
        .get()
        .db.prepare("UPDATE scrobble_links SET secret_cipher = 'AAAA.AAAA.AAAA' WHERE service = ?")
        .run(SCROBBLE_SERVICES.listenBrainz)
      parts.sender.noteListen({ mediaId: ids.track, account })
      await parts.sender.whenIdle()
      expect(warned).toHaveBeenCalledWith(
        "An account's ListenBrainz link no longer opens, so it was removed.",
      )
    } finally {
      warned.mockRestore()
    }
    expect(parts.links.list({ account }).map(({ service }) => service)).toEqual([
      SCROBBLE_SERVICES.lastFm,
    ])
    expect(setup.listenBrainz.submissions).toEqual([])
    expect(queued()).toEqual([])
  })

  it('drops a listen whose link is gone without a warning', async () => {
    const parts = wired()
    const warned = vi.spyOn(Logger.prototype, 'warn')
    try {
      database
        .get()
        .db.prepare(
          `INSERT INTO scrobble_queue (account_id, service, id, media_id, listened_at, attempts, next_at)
           VALUES (?, ?, 1, ?, ?, 0, ?)`,
        )
        .run(account, SCROBBLE_SERVICES.listenBrainz, ids.track, NOW / 1000, NOW)
      parts.sender.kick()
      await parts.sender.whenIdle()
      expect(warned).not.toHaveBeenCalled()
    } finally {
      warned.mockRestore()
    }
    expect(queued()).toEqual([])
  })

  it('sweeps listens past seven days on boot, those left for a service that went off included', async () => {
    const parts = wired()
    await linkBoth(parts)
    parts.queue.noteListen({ mediaId: ids.track, account, services: [SCROBBLE_SERVICES.lastFm] })
    setup.clock.advance(SCROBBLE_KEEP_MS)
    parts.queue.noteListen({ mediaId: ids.track, account, services: [SCROBBLE_SERVICES.lastFm] })
    const keyless = wired({ lastFmKeys: null })
    keyless.sender.onApplicationBootstrap()
    await keyless.sender.whenIdle()
    expect(queued()).toEqual([
      expect.objectContaining({
        service: SCROBBLE_SERVICES.lastFm,
        next_at: NOW + SCROBBLE_KEEP_MS,
      }),
    ])
  })
})
