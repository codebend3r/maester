import { LIBRARY_KINDS, MIX_KINDS, RADIO_SEED_KINDS } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { ViewingRepository } from '@/media/viewingRepository'
import { DEFAULT_LISTENBRAINZ_TIMEOUT_MS, ListenBrainzClient } from '@/music/listenBrainzClient'
import { Mixes } from '@/music/mixes'
import { MusicFavourites } from '@/music/musicFavourites'
import { MusicRepository } from '@/music/musicRepository'
import { Playlists } from '@/music/playlists'
import { Radio } from '@/music/radio'
import { SimilarArtists } from '@/music/similarArtists'
import { STILL_CLOCK } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { fakeListenBrainz } from '@/test/fakeListenBrainz'
import { TEST_ACCOUNTS, pictureVersionsOf, repositories } from '@/test/repositories'

const account = TEST_ACCOUNTS.b

type StoresProps = { database: DatabaseService }

/** The per-account music stores over `database`, wired as the app wires them. */
const stores = ({ database }: StoresProps) => {
  const music = new MusicRepository(database, pictureVersionsOf(database))
  const similar = new SimilarArtists(
    database,
    new ListenBrainzClient(
      fakeListenBrainz({ similar: {} }).fetch,
      STILL_CLOCK,
      DEFAULT_LISTENBRAINZ_TIMEOUT_MS,
    ),
    STILL_CLOCK,
  )
  return {
    playlists: new Playlists(database, music),
    favourites: new MusicFavourites(database, music, new LibrariesRepository(database)),
    mixes: new Mixes(database, music, STILL_CLOCK),
    radio: new Radio(database, music, similar, STILL_CLOCK),
  }
}

type ReadProps = {
  database: DatabaseService
  ids: { playlist: number; album: number; artist: number; track: number }
}

type Read = (from: ReadProps) => unknown

/**
 * Every statement over one account's playlists and its album and artist
 * favourites that SQLite plans; an insert has no plan to read.
 */
const ACCOUNT_STATEMENTS = {
  'its playlists': ({ database }) => stores({ database }).playlists.list({ account, hidden: [] }),
  'one playlist': ({ database, ids }) =>
    stores({ database }).playlists.get({ id: ids.playlist, account, hidden: [] }),
  'a new order': ({ database, ids }) =>
    stores({ database }).playlists.replace({
      id: ids.playlist,
      mediaIds: [ids.track],
      account,
      hidden: [],
    }),
  'more tracks': ({ database, ids }) =>
    stores({ database }).playlists.append({ id: ids.playlist, mediaIds: [ids.track], account }),
  'a rename': ({ database, ids }) =>
    stores({ database }).playlists.rename({ id: ids.playlist, name: 'Again', account }),
  'a share': ({ database, ids }) =>
    stores({ database }).playlists.share({ id: ids.playlist, isShared: true, account }),
  'a copy': ({ database, ids }) =>
    stores({ database }).playlists.copy({ id: ids.playlist, account, hidden: [] }),
  'its album mark': ({ database, ids }) =>
    stores({ database }).favourites.isAlbum({ albumId: ids.album, account }),
  'its artist mark': ({ database, ids }) =>
    stores({ database }).favourites.isArtist({ artistId: ids.artist, account }),
  'an album unmarked': ({ database, ids }) =>
    stores({ database }).favourites.setAlbum({ albumId: ids.album, favourite: false, account }),
  'an artist unmarked': ({ database, ids }) =>
    stores({ database }).favourites.setArtist({ artistId: ids.artist, favourite: false, account }),
  'its favourite albums': ({ database }) => stores({ database }).favourites.albums({ account }),
  'its favourite artists': ({ database }) => stores({ database }).favourites.artists({ account }),
  // Recently added reads no plays, so it has no account's key to search by.
  ...Object.fromEntries(
    Object.values(MIX_KINDS)
      .filter((kind) => kind !== MIX_KINDS.recentlyAdded)
      .map((kind) => [
        `its ${kind} mix`,
        ({ database }: ReadProps) => stores({ database }).mixes.get({ kind, account, hidden: [] }),
      ]),
  ),
  'its recent albums': ({ database }) => stores({ database }).mixes.recent({ account, hidden: [] }),
  'a radio from a track': ({ database, ids }) =>
    stores({ database }).radio.play({
      seed: { kind: RADIO_SEED_KINDS.track, id: ids.track },
      account,
      hidden: [],
    }),
} as const satisfies Record<string, Read>

/** A step over the per-account music tables, by name or the playlists' alias. */
const ACCOUNT_STEP = /^[A-Z-]+ (p|playlists|album_favourites|artist_favourites|pl|plays)\b/

/**
 * A playlist or a favourite found by the account's own key, never by reading
 * every row; or a shared playlist, found by the index that holds those alone.
 */
const BY_ACCOUNT =
  /^SEARCH (p|playlists|album_favourites|artist_favourites) USING (PRIMARY KEY|(COVERING )?INDEX \w+|INTEGER PRIMARY KEY) \((account_id=\?|rowid=\?)|^SEARCH pl USING (COVERING )?INDEX plays_account \(account_id=\?|^SEARCH playlists USING COVERING INDEX playlists_shared \(is_shared=\?\)$/

/** A step over a playlist's tracks, which are read by their playlist's key alone. */
const ORDER_STEP = /^[A-Z-]+ (pt|playlist_tracks)\b/

const ORDER_BY_KEY =
  /^SEARCH (pt|playlist_tracks) USING (COVERING )?(PRIMARY KEY|INDEX \w+) \(playlist_id=\?/

/** A cascade's step over a per-account music table, found by the index kept for it. */
const CASCADE_STEP = /^[A-Z-]+ (playlist_tracks|album_favourites|artist_favourites)\b/

const CASCADE_BY_INDEX =
  /^SEARCH (playlist_tracks|album_favourites|artist_favourites) USING (COVERING )?INDEX (playlist_tracks_media|album_favourites_album|artist_favourites_artist) \((media|album|artist)_id=\?\)$/

describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: "a real library's statistics", prepare: planLikeProduction },
])('how one account’s playlists and music favourites are read, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-music-plans-')
  const ids = { playlist: 0, album: 0, artist: 0, track: 0 }

  beforeEach(async () => {
    await database.open()
    const { db } = database.get()
    const libraryId = new LibrariesRepository(database.get()).create({
      name: 'Music',
      paths: ['/music'],
      settings: { kind: LIBRARY_KINDS.music },
    }).id
    ids.track = new MediaIndex(database.get()).insert({
      libraryId,
      kind: LIBRARY_KINDS.music,
      file: { path: '/music/Band/Album/01 Song.flac', root: '/music', size: 1, mtimeMs: 1 },
    })
    ids.artist = Number(
      db
        .prepare("INSERT INTO artists (name, sort_name, name_key) VALUES ('Band', 'Band', 'band')")
        .run().lastInsertRowid,
    )
    ids.album = Number(
      db
        .prepare(
          `INSERT INTO albums (library_id, album_key, title, sort_title, added_at)
           VALUES (?, 'album', 'Album', 'Album', '2026-10-30')`,
        )
        .run(libraryId).lastInsertRowid,
    )
    db.prepare('INSERT INTO album_artists (album_id, artist_id, position) VALUES (?, ?, 0)').run(
      ids.album,
      ids.artist,
    )
    db.prepare("INSERT INTO tracks (media_id, album_id, title) VALUES (?, ?, 'Song')").run(
      ids.track,
      ids.album,
    )
    const { playlists } = stores({ database: database.get() })
    ids.playlist = playlists.create({ name: 'Mix', account })
    playlists.append({ id: ids.playlist, mediaIds: [ids.track], account })
    new ViewingRepository(database.get(), repositories(database.get()).media).recordPlay({
      id: ids.track,
      account,
    })
    prepare(database.get())
  })

  afterEach(() => database.close())

  /** Every step SQLite took for `read`. */
  const stepsOf = async (read: Read) => {
    const traced = tracedDatabase(database.get())
    try {
      await read({ database: traced.database, ids })
      return traced.steps().map((step) => step.detail)
    } finally {
      traced.database.onModuleDestroy()
    }
  }

  it.each(Object.entries(ACCOUNT_STATEMENTS))(
    'reads %s by the account’s key, and a playlist’s tracks by its own',
    async (_name, read) => {
      const details = await stepsOf(read)
      const byAccount = details.filter((detail) => ACCOUNT_STEP.test(detail))
      const orders = details.filter((detail) => ORDER_STEP.test(detail))

      expect(byAccount).not.toEqual([])
      expect(byAccount.filter((detail) => !BY_ACCOUNT.test(detail))).toEqual([])
      expect(orders.filter((detail) => !ORDER_BY_KEY.test(detail))).toEqual([])
    },
  )

  it('clears a removed file’s, album’s or artist’s rows by index, never reading them all', () => {
    const { db } = database.get()
    const planOf = (sql: string) =>
      db
        .prepare<[number], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(1)
        .map((row) => row.detail)
    const cascades = [
      ...planOf('DELETE FROM media WHERE id = ?'),
      ...planOf('DELETE FROM albums WHERE id = ?'),
      ...planOf('DELETE FROM artists WHERE id = ?'),
    ].filter((detail) => CASCADE_STEP.test(detail))

    expect(cascades).toHaveLength(3)
    expect(cascades.filter((detail) => !CASCADE_BY_INDEX.test(detail))).toEqual([])
  })
})
