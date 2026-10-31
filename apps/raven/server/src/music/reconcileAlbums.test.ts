import { LIBRARY_KINDS, MATCH_STATES, musicListQuery } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MusicRepository } from '@/music/musicRepository'
import { Playlists } from '@/music/playlists'
import { reconcileAlbums } from '@/music/reconcileAlbums'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, pictureVersionsOf } from '@/test/repositories'

describe('repairing existing album folders', () => {
  const database = testDatabase('raven-album-folders-')
  const state = { library: 0 }
  const account = TEST_ACCOUNTS.a
  const music = () => new MusicRepository(database.get(), pictureVersionsOf(database.get()))
  const albums = () =>
    music().listAlbums({ libraryId: state.library, ...musicListQuery.decode({}), account })

  beforeEach(async () => {
    await database.open()
    state.library = new LibrariesRepository(database.get()).create({
      name: 'Music',
      paths: ['/music'],
      settings: { kind: LIBRARY_KINDS.music },
    }).id
  })
  afterEach(database.close)

  type AddAlbumProps = { key: string; mbid?: string; isManual?: boolean; added?: string }
  const addAlbum = ({
    key,
    mbid = 'release',
    isManual = false,
    added = '2026-01-02',
  }: AddAlbumProps) => {
    const { db } = database.get()
    const id = Number(
      db
        .prepare(`INSERT INTO albums
      (library_id, album_key, title, sort_title, added_at, mbid, match)
      VALUES (?, ?, 'Album', 'Album', ?, ?, ?)`)
        .run(state.library, key, added, mbid, isManual ? MATCH_STATES.manual : MATCH_STATES.matched)
        .lastInsertRowid,
    )
    db.prepare(
      "INSERT OR IGNORE INTO artists (id, name, sort_name, name_key) VALUES (1, 'Band', 'Band', 'band')",
    ).run()
    db.prepare('INSERT INTO album_artists (album_id, artist_id, position) VALUES (?, 1, 0)').run(id)
    return id
  }
  type AddTrackProps = { album: number; path: string }
  const addTrack = ({ album, path }: AddTrackProps) => {
    const id = new MediaIndex(database.get()).insert({
      libraryId: state.library,
      kind: LIBRARY_KINDS.music,
      file: { path, root: '/music', size: 1, mtimeMs: 1 },
    })
    database
      .get()
      .db.prepare("INSERT INTO tracks (media_id, album_id, title) VALUES (?, ?, 'Song')")
      .run(id, album)
    return id
  }
  type FavouriteProps = { album: number; viewer?: string; at?: string }
  const favourite = ({ album, viewer = account, at = '2026-01-03' }: FavouriteProps) => {
    database
      .get()
      .db.prepare('INSERT INTO album_favourites (account_id, album_id, added_at) VALUES (?, ?, ?)')
      .run(viewer, album, at)
  }

  it('merges inconsistent release tags across three discs, preserving ids, account favourites and playlists', () => {
    const first = addAlbum({ key: 'mbid:a', added: '2026-01-01' })
    const second = addAlbum({ key: 'name:band:album' })
    const third = addAlbum({ key: 'mbid:b' })
    const tracks = [first, second, third].map((album, at) =>
      addTrack({ album, path: `/music/Band/Album/CD${at + 1}/01.flac` }),
    )
    favourite({ album: first, at: '2026-01-05' })
    favourite({ album: second, at: '2026-01-03' })
    favourite({ album: third, viewer: TEST_ACCOUNTS.b })
    const playlists = new Playlists(database.get(), music())
    const playlist = playlists.create({ name: 'Keep', account })
    playlists.append({ id: playlist, mediaIds: tracks, account })
    reconcileAlbums({ db: database.get().db })
    const repaired = albums()
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({
      id: first,
      trackCount: 3,
      addedAt: '2026-01-01',
      artists: [{ name: 'Band' }],
    })
    expect(
      music()
        .album(first)
        ?.tracks.map(({ id, disc }) => ({ id, disc })),
    ).toEqual(tracks.map((id, at) => ({ id, disc: at + 1 })))
    expect(
      playlists.get({ id: playlist, account, hidden: [] })?.tracks.map(({ id }) => id),
    ).toEqual(tracks)
    ;[account, TEST_ACCOUNTS.b].forEach((viewer) => {
      expect(
        database
          .get()
          .db.prepare('SELECT album_id, added_at FROM album_favourites WHERE account_id = ?')
          .all(viewer),
      ).toEqual([{ album_id: first, added_at: '2026-01-03' }])
    })
    reconcileAlbums({ db: database.get().db })
    expect(albums()).toEqual(repaired)
  })

  it('splits separate edition folders that used to share one release id without losing either favourite', () => {
    const original = addAlbum({ key: 'mbid:shared', isManual: true })
    const first = addTrack({ album: original, path: '/music/Band/Album/01.flac' })
    const second = addTrack({ album: original, path: '/music/Band/Album Deluxe/01.flac' })
    favourite({ album: original })
    reconcileAlbums({ db: database.get().db })
    const repaired = albums()
    expect(repaired).toHaveLength(2)
    expect(
      repaired.every(({ match, artists }) => match === MATCH_STATES.manual && artists.length === 1),
    ).toBe(true)
    expect(
      new Set([
        music().tracks([first]).get(first)?.albumId,
        music().tracks([second]).get(second)?.albumId,
      ]).size,
    ).toBe(2)
    expect(
      database
        .get()
        .db.prepare('SELECT album_id FROM album_favourites WHERE account_id = ?')
        .all(account),
    ).toHaveLength(2)
    reconcileAlbums({ db: database.get().db })
    expect(albums()).toEqual(repaired)
  })

  it('preserves conflicting manual choices instead of silently discarding one', () => {
    const first = addAlbum({ key: 'mbid:a', mbid: 'a', isManual: true })
    const second = addAlbum({ key: 'mbid:b', mbid: 'b', isManual: true })
    addTrack({ album: first, path: '/music/Band/Album/01.flac' })
    addTrack({ album: second, path: '/music/Band/Album/02.flac' })
    favourite({ album: first })
    favourite({ album: second })
    reconcileAlbums({ db: database.get().db })
    expect(albums()).toHaveLength(2)
    expect(music().album(first)?.mbid).toBe('a')
    expect(music().album(second)?.mbid).toBe('b')
    expect(
      database
        .get()
        .db.prepare('SELECT album_id FROM album_favourites WHERE account_id = ?')
        .all(account),
    ).toHaveLength(2)
  })
})
