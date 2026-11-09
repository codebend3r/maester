import { LIBRARY_KINDS, MATCH_STATES, type MatchState } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { foldStrayAlbums } from '@/music/strayAlbums'
import { testDatabase } from '@/test/database'

describe('folding stray albums into the album of their folder', () => {
  const database = testDatabase('raven-stray-albums-')
  const state = { library: 0 }

  beforeEach(async () => {
    await database.open()
    state.library = new LibrariesRepository(database.get()).create({
      name: 'Music',
      paths: ['/music'],
      settings: { kind: LIBRARY_KINDS.music },
    }).id
    database
      .get()
      .db.prepare(
        "INSERT INTO artists (id, name, sort_name, name_key) VALUES (1, 'Bruno Mars', 'Bruno Mars', 'bruno mars'), (2, 'Queen', 'Queen', 'queen')",
      )
      .run()
  })
  afterEach(database.close)

  type AddAlbumProps = {
    title: string
    artist: number
    match?: MatchState
    paths: readonly string[]
  }

  const addAlbum = ({ title, artist, match = MATCH_STATES.unmatched, paths }: AddAlbumProps) => {
    const { db } = database.get()
    const id = Number(
      db
        .prepare(
          `INSERT INTO albums (library_id, album_key, title, sort_title, added_at, match)
           VALUES (?, ?, ?, ?, '2026-01-01', ?)`,
        )
        .run(state.library, `folder:${paths[0]}`, title, title, match).lastInsertRowid,
    )
    db.prepare('INSERT INTO album_artists (album_id, artist_id, position) VALUES (?, ?, 0)').run(
      id,
      artist,
    )
    paths.forEach((path, number) => {
      const media = new MediaIndex(database.get()).insert({
        libraryId: state.library,
        kind: LIBRARY_KINDS.music,
        file: { path, root: '/music', size: 1, mtimeMs: 1 },
      })
      db.prepare('INSERT INTO tracks (media_id, album_id, title, number) VALUES (?, ?, ?, ?)').run(
        media,
        id,
        `Song ${number}`,
        number + 1,
      )
    })
    return id
  }

  const tracksOf = (album: number): number =>
    database
      .get()
      .db.prepare<[number], { total: number }>(
        'SELECT COUNT(*) AS total FROM tracks WHERE album_id = ?',
      )
      .get(album)?.total ?? 0

  const songs = (folder: string, count: number): string[] =>
    Array.from({ length: count }, (_, n) => `${folder}/${String(n + 1).padStart(2, '0')}.flac`)

  it('folds a bonus track filed in the folder beside its album, under the same title', () => {
    const album = addAlbum({
      title: 'Doo-Wops & Hooligans Deluxe Edition',
      artist: 1,
      paths: songs('/music/Bruno Mars/Bruno Mars - Doo-Wops & Hooligans (2010)', 15),
    })
    addAlbum({
      title: 'Doo-Wops & Hooligans Deluxe Edition',
      artist: 1,
      paths: ['/music/Bruno Mars/Bruno Mars - Doo-Wops & Hooligans Deluxe Edition (2025)/11.flac'],
    })
    expect(foldStrayAlbums({ db: database.get().db, libraryId: state.library })).toEqual([
      {
        from: 'Doo-Wops & Hooligans Deluxe Edition',
        into: 'Doo-Wops & Hooligans Deluxe Edition',
        tracks: 1,
      },
    ])
    expect(tracksOf(album)).toBe(16)
  })

  it('folds the discs of one folder into one album, the larger keeping them', () => {
    const folder = '/music/Queen/Queen - Live at Wembley Stadium (2011)'
    const first = addAlbum({
      title: 'Live At Wembley Stadium',
      artist: 2,
      paths: songs(`${folder}/Digital Media 01`, 13),
    })
    const second = addAlbum({
      title: 'Live At Wembley Stadium',
      artist: 2,
      paths: songs(`${folder}/Digital Media 02`, 15),
    })
    expect(foldStrayAlbums({ db: database.get().db, libraryId: state.library })).toEqual([
      { from: 'Live At Wembley Stadium', into: 'Live At Wembley Stadium', tracks: 13 },
    ])
    expect(tracksOf(second)).toBe(28)
    expect(tracksOf(first)).toBe(0)
  })

  it('leaves an album of its own folder, another title beside it, and a hand match alone', () => {
    addAlbum({
      title: 'Doo-Wops & Hooligans',
      artist: 1,
      paths: songs('/music/Bruno Mars/Bruno Mars - Doo-Wops & Hooligans (2010)', 12),
    })
    addAlbum({
      title: 'Unorthodox Jukebox',
      artist: 1,
      paths: ['/music/Bruno Mars/Bruno Mars - Unorthodox Jukebox (2012)/01.flac'],
    })
    addAlbum({
      title: 'Doo-Wops & Hooligans',
      artist: 1,
      match: MATCH_STATES.manual,
      paths: ['/music/Bruno Mars/Bruno Mars - Doo-Wops & Hooligans Bonus/01.flac'],
    })
    addAlbum({
      title: 'Doo-Wops & Hooligans',
      artist: 1,
      paths: songs('/music/Bruno Mars/Bruno Mars - Doo-Wops & Hooligans Live', 4),
    })
    expect(foldStrayAlbums({ db: database.get().db, libraryId: state.library })).toEqual([])
  })
})
