import { SCROBBLE_SERVICES } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseService } from '@/db/database'
import { ScrobbleCipher } from '@/scrobbling/scrobbleCipher'
import { ScrobbleLinks } from '@/scrobbling/scrobbleLinks'
import { ScrobbleQueue } from '@/scrobbling/scrobbleQueue'
import { SettingsRepository } from '@/settings/settingsRepository'
import { STILL_CLOCK } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { musicLibrary } from '@/test/musicLibrary'
import { planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { TEST_ACCOUNTS } from '@/test/repositories'

const account = TEST_ACCOUNTS.b

const service = SCROBBLE_SERVICES.listenBrainz

type StoresProps = { database: DatabaseService }

const stores = ({ database }: StoresProps) => ({
  links: new ScrobbleLinks(database, new ScrobbleCipher(new SettingsRepository(database))),
  queue: new ScrobbleQueue(database, STILL_CLOCK),
})

type ReadProps = { database: DatabaseService; track: number }

type Read = (from: ReadProps) => unknown

/** Every statement over the scrobbling tables that SQLite plans; an insert of values has no plan to read. */
const STATEMENTS = {
  'its links': ({ database }) => stores({ database }).links.list({ account }),
  'its secret': ({ database }) => stores({ database }).links.secretOf({ account, service }),
  'a listen queued': ({ database, track }) =>
    stores({ database }).queue.noteListen({ mediaId: track, account, services: [service] }),
  'the next due': ({ database }) => stores({ database }).queue.nextDue({ service }),
  'when the next falls due': ({ database }) => stores({ database }).queue.nextAt({ service }),
  'a retry': ({ database }) =>
    stores({ database }).queue.retry({ account, service, id: 1, attempts: 1, nextAt: 0 }),
  'a listen sent': ({ database }) => stores({ database }).queue.remove({ account, service, id: 1 }),
  'an unlink': ({ database }) => stores({ database }).links.remove({ account, service }),
  'old listens swept': ({ database }) => stores({ database }).queue.dropBefore({ seconds: 0 }),
} as const satisfies Record<string, Read>

/** A step over a scrobbling table, by name or alias. */
const SCROBBLE_STEP = /^[A-Z-]+ (l|q|scrobble_links|scrobble_queue)\b/

/** A link or a waiting listen found by its key or an index kept for the read, never every row. */
const BY_KEY =
  /^SEARCH (l|q|scrobble_links|scrobble_queue) USING (PRIMARY KEY|(COVERING )?INDEX (scrobble_queue_due|scrobble_queue_media|scrobble_queue_listened)) \((account_id=\?|service=\?|media_id=\?|listened_at<\?)/

describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: "a real library's statistics", prepare: planLikeProduction },
])('how scrobbling is read, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-scrobble-plans-')
  const ids = { track: 0 }

  beforeEach(async () => {
    await database.open()
    const { addLibrary, addTrack } = musicLibrary(database.get())
    ids.track = addTrack({
      libraryId: addLibrary({ name: 'Music' }),
      title: 'Song',
      artist: 'Band',
      album: 'Album',
    })
    const { links, queue } = stores({ database: database.get() })
    links.save({ account, service, username: 'rj', secret: 'token', at: new Date() })
    queue.noteListen({ mediaId: ids.track, account, services: [service] })
    prepare(database.get())
  })

  afterEach(() => database.close())

  it.each(Object.entries(STATEMENTS))('reads %s by key, never every row', async (_name, read) => {
    const traced = tracedDatabase(database.get())
    try {
      await read({ database: traced.database, track: ids.track })
      const details = traced
        .steps()
        .map((step) => step.detail)
        .filter((detail) => SCROBBLE_STEP.test(detail))
      expect(details).not.toEqual([])
      expect(details.filter((detail) => !BY_KEY.test(detail))).toEqual([])
    } finally {
      traced.database.onModuleDestroy()
    }
  })

  it('clears a removed file’s waiting listens by index', () => {
    const steps = database
      .get()
      .db.prepare<[number], { detail: string }>('EXPLAIN QUERY PLAN DELETE FROM media WHERE id = ?')
      .all(1)
      .map((row) => row.detail)
      .filter((detail) => SCROBBLE_STEP.test(detail))
    expect(steps).toEqual([
      expect.stringMatching(/^SEARCH scrobble_queue USING (COVERING )?INDEX scrobble_queue_media/u),
    ])
  })
})
