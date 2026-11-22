import {
  LIBRARY_KINDS,
  MEDIA_SORTS,
  MUSIC_SORTS,
  type MusicSort,
  SORT_DIRECTIONS,
  musicListQuery,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import type { AudioFormat, AudioTags } from '@/music/audioReader'
import { COVER_SOURCES, MusicCoverStore } from '@/music/musicCoverStore'
import { MusicRepository } from '@/music/musicRepository'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, pictureVersionsOf, repositories } from '@/test/repositories'

const NO_TAGS: AudioTags = {
  title: null,
  artists: [],
  album: null,
  albumArtists: [],
  trackNumber: null,
  disc: null,
  year: null,
  originalYear: null,
  releaseDate: null,
  genres: [],
  isCompilation: false,
  label: null,
  isrc: null,
  recordingMbid: null,
  releaseMbid: null,
  releaseGroupMbid: null,
  artistMbids: [],
  albumArtistMbids: [],
  releaseTypes: [],
  replayGain: { trackGain: null, trackPeak: null, albumGain: null, albumPeak: null },
  hasCover: false,
}

const FLAC: AudioFormat = { sampleRate: 44100, bitDepth: 16, isLossless: true }

const LIST = { ...musicListQuery.decode({}), account: TEST_ACCOUNTS.a }

describe('MusicRepository', () => {
  const database = testDatabase('raven-music-')
  const state = { library: 0, other: 0, ids: new Map<string, number>() }
  const repository = () => new MusicRepository(database.get(), pictureVersionsOf(database.get()))
  const coverStore = () => new MusicCoverStore(database.get(), pictureVersionsOf(database.get()))

  type AddFileProps = { libraryId?: number; path: string; tags: Partial<AudioTags>; at?: Date }

  /** A file in the index, read and filed as the scanner would. */
  const addFile = ({ libraryId = state.library, path, tags, at }: AddFileProps): number => {
    const index = new MediaIndex(database.get())
    const id = index.insert({
      libraryId,
      kind: LIBRARY_KINDS.music,
      file: { path, root: '/music', size: 1, mtimeMs: 1 },
      at,
    })
    index.saveProbe({
      id,
      probe: {
        duration: 200,
        width: null,
        height: null,
        videoCodec: null,
        videoBitDepth: null,
        hdr: false,
        isDolbyVisionOnly: false,
        dolbyVisionProfile: null,
        audioCodec: 'flac',
        audioChannels: 2,
        bitrate: 900000,
      },
      tracks: { audio: [], subtitles: [], defaultAudio: null, frameRate: null },
      chapters: [],
    })
    repository().record({
      mediaId: id,
      libraryId,
      path,
      tags: { ...NO_TAGS, ...tags },
      format: FLAC,
      folderCover: null,
      at,
    })
    state.ids.set(path, id)
    return id
  }

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.library = libraries.create({
      name: 'Music',
      paths: ['/music'],
      settings: { kind: LIBRARY_KINDS.music },
    }).id
    state.other = libraries.create({
      name: 'More music',
      paths: ['/more'],
      settings: { kind: LIBRARY_KINDS.music },
    }).id
    const okComputer = {
      album: 'OK Computer',
      albumArtists: ['Radiohead'],
      artists: ['Radiohead'],
      releaseMbid: 'rel-ok',
      year: 1997,
      genres: ['Alternative Rock'],
      label: 'Parlophone',
    }
    addFile({
      path: '/music/Radiohead/OK Computer/01 Airbag.flac',
      tags: { ...okComputer, title: 'Airbag', trackNumber: 1, hasCover: true },
      at: new Date('2026-01-01T00:00:00Z'),
    })
    addFile({
      path: '/music/Radiohead/OK Computer/02 Paranoid Android.flac',
      tags: { ...okComputer, title: 'Paranoid Android', trackNumber: 2 },
      at: new Date('2026-01-02T00:00:00Z'),
    })
    // A two-disc album with no ids, where a guest sings on one track.
    const kid = { album: 'Kid A', albumArtists: ['Radiohead'], year: 2000 }
    addFile({
      path: '/music/Radiohead/Kid A/CD 01/01 Everything.flac',
      tags: {
        ...kid,
        title: 'Everything in Its Right Place',
        artists: ['Radiohead'],
        disc: 1,
        trackNumber: 1,
      },
    })
    addFile({
      path: '/music/Radiohead/Kid A/CD 02/01 Guest.flac',
      tags: {
        ...kid,
        title: 'A Guest Appears',
        artists: ['Radiohead', 'Guest Singer'],
        disc: 2,
        trackNumber: 1,
      },
    })
    // An untagged file, filed by its folder.
    addFile({ path: '/music/Unknown Band/Demo Tape/take 1.flac', tags: {} })
    // The same artist in another library.
    addFile({
      libraryId: state.other,
      path: '/more/Radiohead/Amnesiac/01 Pyramid Song.flac',
      tags: {
        album: 'Amnesiac',
        albumArtists: ['Radiohead'],
        artists: ['Radiohead'],
        year: 2001,
        title: 'Pyramid Song',
      },
    })
  })

  afterAll(database.close)

  /** The guest who sings on a track of Kid A, found by name since no listing of album artists holds them. */
  const guestOf = (): number =>
    database
      .get()
      .db.prepare<[string], { id: number }>('SELECT id FROM artists WHERE name = ?')
      .get('Guest Singer')?.id ?? 0

  it('lists a library’s albums with their credits, counts and lengths, by title', () => {
    const albums = repository().listAlbums({ libraryId: state.library, ...LIST })
    expect(
      albums.map(({ title, artists, trackCount, duration, year, coverVersion }) => ({
        title,
        artists: artists.map(({ name }) => name),
        trackCount,
        duration,
        year,
        hasCover: coverVersion !== null,
      })),
    ).toEqual([
      {
        title: 'Demo Tape',
        artists: ['Unknown Band'],
        trackCount: 1,
        duration: 200,
        year: null,
        hasCover: false,
      },
      {
        title: 'Kid A',
        artists: ['Radiohead'],
        trackCount: 2,
        duration: 400,
        year: 2000,
        hasCover: false,
      },
      {
        title: 'OK Computer',
        artists: ['Radiohead'],
        trackCount: 2,
        duration: 400,
        year: 1997,
        hasCover: true,
      },
    ])
  })

  it('sorts albums by artist, year and when they came, and searches titles and artists', () => {
    type TitlesProps = { sort: MusicSort; search?: string }
    const titles = ({ sort, search = '' }: TitlesProps) =>
      repository()
        .listAlbums({ libraryId: state.library, ...LIST, sort, search })
        .map(({ title }) => title)
    expect(titles({ sort: MUSIC_SORTS.artist })).toEqual(['OK Computer', 'Kid A', 'Demo Tape'])
    expect(titles({ sort: MUSIC_SORTS.year })).toEqual(['OK Computer', 'Kid A', 'Demo Tape'])
    expect(titles({ sort: MUSIC_SORTS.added })[0]).toBe('Demo Tape')
    expect(titles({ sort: MUSIC_SORTS.title, search: 'radio' })).toEqual(['Kid A', 'OK Computer'])
    expect(titles({ sort: MUSIC_SORTS.title, search: 'kid' })).toEqual(['Kid A'])
  })

  it('dates each album by its newest file on disk, sorts albums and tracks by it, and keeps undated albums last', () => {
    const { db } = database.get()
    const touch = db.prepare('UPDATE media SET mtime_ms = ? WHERE id = ?')
    const mtimes = [
      ['/music/Radiohead/OK Computer/01 Airbag.flac', Date.parse('2026-03-01T00:00:00Z')],
      ['/music/Radiohead/OK Computer/02 Paranoid Android.flac', Date.parse('2026-05-01T00:00:00Z')],
      ['/music/Radiohead/Kid A/CD 01/01 Everything.flac', Date.parse('2026-04-01T00:00:00Z')],
      ['/music/Radiohead/Kid A/CD 02/01 Guest.flac', Date.parse('2026-02-01T00:00:00Z')],
      ['/music/Unknown Band/Demo Tape/take 1.flac', Date.parse('2026-01-01T00:00:00Z')],
    ] as const
    mtimes.forEach(([path, mtime]) => touch.run(mtime, state.ids.get(path) ?? 0))
    type ListedProps = { order?: typeof SORT_DIRECTIONS.ascending }
    const albums = ({ order }: ListedProps = {}) =>
      repository().listAlbums({
        libraryId: state.library,
        ...LIST,
        sort: MUSIC_SORTS.modified,
        order,
      })
    expect(albums().map(({ title, modifiedAt }) => ({ title, modifiedAt }))).toEqual([
      { title: 'OK Computer', modifiedAt: '2026-05-01T00:00:00.000Z' },
      { title: 'Kid A', modifiedAt: '2026-04-01T00:00:00.000Z' },
      { title: 'Demo Tape', modifiedAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(albums({ order: SORT_DIRECTIONS.ascending }).map(({ title }) => title)).toEqual([
      'Demo Tape',
      'Kid A',
      'OK Computer',
    ])
    const tracks = ({ order }: ListedProps = {}) =>
      repository()
        .listTracks({ libraryId: state.library, ...LIST, sort: MUSIC_SORTS.modified, order })
        .tracks.map(({ id }) => id)
    const newestFirst = [1, 2, 0, 3, 4].map((at) => state.ids.get(mtimes[at]?.[0] ?? '') ?? 0)
    expect(tracks()).toEqual(newestFirst)
    expect(tracks({ order: SORT_DIRECTIONS.ascending })).toEqual(newestFirst.toReversed())
    const queued = repository().listTracks({
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.modified,
      byAlbum: true,
    })
    expect([...new Set(queued.tracks.map(({ albumId }) => albumId))]).toEqual(
      albums().map(({ id }) => id),
    )
    // An album with no file left on disk has no date, and lists after every dated one.
    const empty = db
      .prepare<[number], { id: number }>(
        `INSERT INTO albums (library_id, album_key, title, sort_title, added_at)
         VALUES (?, 'empty', 'Empty', 'Empty', '2026-01-01') RETURNING id`,
      )
      .get(state.library)
    const undated = albums().find(({ title }) => title === 'Empty')
    expect(undated).toBeDefined()
    expect(undated).not.toHaveProperty('modifiedAt')
    expect(albums().at(-1)?.title).toBe('Empty')
    expect(albums({ order: SORT_DIRECTIONS.ascending }).at(-1)?.title).toBe('Empty')
    db.prepare('DELETE FROM albums WHERE id = ?').run(empty?.id ?? 0)
  })

  it('lists the album artists of the library, with how many of its albums are theirs and the tracks on them', () => {
    const counted = (search = '') =>
      repository()
        .listArtists({ libraryId: state.library, ...LIST, search })
        .map(({ name, albumCount, trackCount }) => ({ name, albumCount, trackCount }))
    // The guest sings on a track of Kid A but is no album's artist, so is not listed.
    expect(counted()).toEqual([
      { name: 'Radiohead', albumCount: 2, trackCount: 4 },
      // Filed by its folder, the folder above is its album's artist.
      { name: 'Unknown Band', albumCount: 1, trackCount: 1 },
    ])
    expect(repository().countArtists(state.library)).toBe(2)
    expect(repository().countAlbums(state.library)).toBe(3)
    expect(counted('radio')).toEqual([{ name: 'Radiohead', albumCount: 2, trackCount: 4 }])
    expect(counted('guest')).toEqual([])
    // Amnesiac is in the other library, so Radiohead counts one album there.
    expect(
      repository()
        .listArtists({ libraryId: state.other, ...LIST })
        .map(({ name, albumCount, trackCount }) => ({ name, albumCount, trackCount })),
    ).toEqual([{ name: 'Radiohead', albumCount: 1, trackCount: 1 }])
  })

  it('counts an album artist’s tracks as their albums show them, one copy of a track held twice', () => {
    const copy = '/music/Radiohead/OK Computer/01 Airbag (copy).flac'
    addFile({
      path: copy,
      tags: {
        album: 'OK Computer',
        albumArtists: ['Radiohead'],
        artists: ['Radiohead'],
        releaseMbid: 'rel-ok',
        year: 1997,
        title: 'Airbag',
        trackNumber: 1,
      },
    })
    const radiohead = repository()
      .listArtists({ libraryId: state.library, ...LIST })
      .find(({ name }) => name === 'Radiohead')
    expect(radiohead).toMatchObject({ albumCount: 2, trackCount: 4 })
    const page = repository().artist({
      id: radiohead?.id ?? 0,
      account: TEST_ACCOUNTS.a,
      seesLibrary: () => true,
    })
    expect(page?.artist).toMatchObject({ albumCount: 3, trackCount: 5 })
    expect(
      repository()
        .artists({ ids: [radiohead?.id ?? 0], hidden: [] })
        .get(radiohead?.id ?? 0),
    ).toMatchObject({ albumCount: 3, trackCount: 5 })
    new MediaIndex(database.get()).remove([state.ids.get(copy) ?? 0])
    repository().prune()
  })

  it('stores one capability-addressed photo lookup for each album artist with a MusicBrainz id', () => {
    database
      .get()
      .db.prepare('UPDATE artists SET mbid = ? WHERE name = ?')
      .run('artist-radiohead', 'Radiohead')
    const radiohead = repository()
      .listArtists({ libraryId: state.library, ...LIST })
      .find(({ mbid }) => mbid === 'artist-radiohead')
    expect(radiohead?.photoVersion).not.toBeNull()
    expect(
      coverStore().artistPicture({
        id: radiohead?.id ?? 0,
        version: radiohead?.photoVersion ?? '',
      }),
    ).toEqual({ mbid: 'artist-radiohead', picture: null, isFetched: false })
    const picture = 'https://commons.wikimedia.org/radiohead.jpg'
    coverStore().setArtistPicture({ id: radiohead?.id ?? 0, picture })
    expect(
      coverStore().artistPicture({
        id: radiohead?.id ?? 0,
        version: radiohead?.photoVersion ?? '',
      }),
    ).toEqual({ mbid: 'artist-radiohead', picture, isFetched: true })
    expect(coverStore().artistPicture({ id: radiohead?.id ?? 0, version: 'wrong' })).toBeNull()
  })

  it('pages the tracks in the order asked, with the whole count', () => {
    const first = repository().listTracks({
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.artist,
      limit: 2,
      offset: 0,
    })
    expect(first.total).toBe(5)
    expect(first.tracks.map(({ title }) => title)).toEqual(['Airbag', 'Paranoid Android'])
    const next = repository().listTracks({
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.artist,
      limit: 2,
      offset: 2,
    })
    expect(next.tracks.map(({ title, disc }) => `${disc}:${title}`)).toEqual([
      '1:Everything in Its Right Place',
      '2:A Guest Appears',
    ])
    expect(
      repository()
        .listTracks({ libraryId: state.library, ...LIST, search: 'guest' })
        .tracks.map(({ title }) => title),
    ).toEqual(['A Guest Appears'])
  })

  it('reads a track as the queue needs it: its file facts, its artists and its album', () => {
    const page = repository().listTracks({ libraryId: state.library, ...LIST, search: 'Airbag' })
    expect(page.tracks[0]).toMatchObject({
      id: state.ids.get('/music/Radiohead/OK Computer/01 Airbag.flac'),
      libraryId: state.library,
      title: 'Airbag',
      disc: 1,
      number: 1,
      duration: 200,
      artists: [{ name: 'Radiohead' }],
      container: 'flac',
      codec: 'flac',
      bitrate: 900000,
      sampleRate: 44100,
      bitDepth: 16,
      isLossless: true,
    })
  })

  it('names the album each music file is a track of, and leaves out a file that is none', () => {
    const airbag = state.ids.get('/music/Radiohead/OK Computer/01 Airbag.flac') ?? 0
    const albums = repository().albumsOfMedia([airbag, -1])
    expect([...albums.keys()]).toEqual([airbag])
    expect(albums.get(airbag)).toMatchObject({ title: 'OK Computer' })
    expect(repository().albumsOfMedia([]).size).toBe(0)
  })

  it('gives an album’s page its tracks in disc order, its discs, label and genres', () => {
    const [, kidA, okComputer] = repository().listAlbums({ libraryId: state.library, ...LIST })
    const details = repository().album({ id: okComputer?.id ?? 0 })
    expect(details).toMatchObject({
      label: 'Parlophone',
      genres: ['Alternative Rock'],
      mbid: 'rel-ok',
      discCount: 1,
    })
    expect(details?.tracks.map(({ number, title }) => `${number} ${title}`)).toEqual([
      '1 Airbag',
      '2 Paranoid Android',
    ])
    const twoDiscs = repository().album({ id: kidA?.id ?? 0 })
    expect(twoDiscs?.discCount).toBe(2)
    expect(twoDiscs?.tracks.map(({ artists }) => artists.map(({ name }) => name))).toEqual([
      ['Radiohead'],
      ['Radiohead', 'Guest Singer'],
    ])
    expect(repository().album({ id: 999 })).toBeNull()
  })

  it('gives an artist’s page their albums across libraries, and what they appear on, hiding libraries the caller may not see', () => {
    const radiohead = repository()
      .listArtists({ libraryId: state.library, ...LIST })
      .find(({ name }) => name === 'Radiohead')
    const page = repository().artist({
      id: radiohead?.id ?? 0,
      account: TEST_ACCOUNTS.a,
      seesLibrary: () => true,
    })
    expect(page?.albums.map(({ title }) => title)).toEqual(['OK Computer', 'Kid A', 'Amnesiac'])
    expect(page?.appearsOn).toEqual([])
    expect(page?.artist).toMatchObject({ name: 'Radiohead', albumCount: 3, trackCount: 5 })
    const hidden = repository().artist({
      id: radiohead?.id ?? 0,
      account: TEST_ACCOUNTS.a,
      seesLibrary: (libraryId) => libraryId !== state.other,
    })
    expect(hidden?.albums.map(({ title }) => title)).toEqual(['OK Computer', 'Kid A'])
    expect(hidden?.artist.albumCount).toBe(2)
    const guest = guestOf()
    const guestPage = repository().artist({
      id: guest,
      account: TEST_ACCOUNTS.a,
      seesLibrary: () => true,
    })
    expect(guestPage?.albums).toEqual([])
    expect(guestPage?.appearsOn.map(({ title }) => title)).toEqual(['Kid A'])
    // Their page and a favourite's card count the track they sing on, and no album.
    expect(guestPage?.artist).toMatchObject({ albumCount: 0, trackCount: 1 })
    expect(
      repository()
        .artists({ ids: [guest], hidden: [] })
        .get(guest),
    ).toMatchObject({
      albumCount: 0,
      trackCount: 1,
    })
    expect(
      repository()
        .artists({ ids: [radiohead?.id ?? 0], hidden: [state.other] })
        .get(radiohead?.id ?? 0),
    ).toMatchObject({ albumCount: 2, trackCount: 4 })
    expect(
      repository().artist({ id: 999, account: TEST_ACCOUNTS.a, seesLibrary: () => true }),
    ).toBeNull()
  })

  it('finds an album’s cover by its current version and no other, in the file that embeds it', () => {
    const okComputer = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .find(({ title }) => title === 'OK Computer')
    const version = okComputer?.coverVersion ?? ''
    expect(coverStore().cover({ id: okComputer?.id ?? 0, version })).toEqual({
      source: COVER_SOURCES.embedded,
      ref: String(state.ids.get('/music/Radiohead/OK Computer/01 Airbag.flac')),
    })
    expect(coverStore().cover({ id: okComputer?.id ?? 0, version: 'stale' })).toBeNull()
    expect(repository().libraryOfAlbum(okComputer?.id ?? 0)).toBe(state.library)
    expect(repository().libraryOfAlbum(999)).toBeNull()
  })

  it('takes a folder cover for an album with none, and keeps the one it has', () => {
    const path = '/music/Unknown Band/Demo Tape/take 2.flac'
    const id = addFile({ path, tags: {} })
    const folderCover = '/music/Unknown Band/Demo Tape/cover.jpg'
    const recordWith = (cover: string | null) =>
      repository().record({
        mediaId: id,
        libraryId: state.library,
        path,
        tags: NO_TAGS,
        format: FLAC,
        folderCover: cover,
      })
    recordWith(folderCover)
    const demo = () =>
      repository()
        .listAlbums({ libraryId: state.library, ...LIST })
        .find(({ title }) => title === 'Demo Tape')
    const version = demo()?.coverVersion ?? ''
    expect(coverStore().cover({ id: demo()?.id ?? 0, version })).toEqual({
      source: COVER_SOURCES.file,
      ref: folderCover,
    })
    recordWith('/music/Unknown Band/Demo Tape/front.jpg')
    expect(demo()?.coverVersion).toBe(version)
  })

  it('credits an album by its tags once a file names its artists, over credits that stood in from the folder', () => {
    addFile({
      path: '/music/Unknown Band/Demo Tape/take 4.flac',
      tags: { albumArtists: ['The Unknowns'] },
    })
    const demo = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .find(({ title }) => title === 'Demo Tape')
    expect(demo?.artists.map(({ name }) => name)).toEqual(['The Unknowns'])
  })

  it('learns an artist’s id from a later file, and never makes a second artist for it', () => {
    addFile({
      path: '/music/Unknown Band/Demo Tape/take 3.flac',
      tags: { artists: ['Unknown Band'], artistMbids: ['band-1'] },
    })
    // Credited only on the track by now, the band is no album's artist, so it is read from the table.
    expect(
      database
        .get()
        .db.prepare<[string], { mbid: string | null }>('SELECT mbid FROM artists WHERE name = ?')
        .all('Unknown Band'),
    ).toEqual([{ mbid: 'band-1' }])
  })

  it('keeps a file in its folder album when its tags change, and refreshes track credits', () => {
    const path = '/music/Radiohead/Kid A/CD 02/01 Guest.flac'
    const id = state.ids.get(path) ?? 0
    const guest = guestOf()
    repository().record({
      mediaId: id,
      libraryId: state.library,
      path,
      tags: { ...NO_TAGS, album: 'Kid B', albumArtists: ['Radiohead'], artists: ['Radiohead'] },
      format: FLAC,
      folderCover: null,
    })
    const titles = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .map(({ title }) => title)
    expect(titles).not.toContain('Kid B')
    expect(titles).toContain('Kid A')
    expect(
      repository()
        .artists({ ids: [guest], hidden: [] })
        .get(guest),
    ).toMatchObject({
      albumCount: 0,
      trackCount: 0,
    })
  })

  it('sorts precise dates, keeps unknown dates last in either direction, and queues whole albums in grid order', () => {
    const { db } = database.get()
    const dated = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .filter(({ year }) => year !== null)
    dated.forEach((album, at) =>
      db
        .prepare('UPDATE albums SET release_date = ? WHERE id = ?')
        .run(`1997-05-${at === 0 ? '22' : '21'}`, album.id),
    )
    const newest = repository().listAlbums({
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.release,
    })
    expect(
      newest
        .filter(({ releaseDate }) => releaseDate !== null)
        .map(({ releaseDate }) => releaseDate),
    ).toEqual(['1997-05-22', '1997-05-21'])
    const oldest = repository().listAlbums({
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.release,
      order: 'ascending',
    })
    expect(oldest.at(-1)?.releaseDate).toBeNull()
    const files = repositories(database.get()).media.list({
      libraryId: state.library,
      account: TEST_ACCOUNTS.a,
      sort: MEDIA_SORTS.yearNew,
    })
    expect([...new Set(files.map(({ album }) => album?.id ?? null))]).toEqual(
      newest.map(({ id }) => id),
    )
    const queued = repository().listTracks({
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.release,
      byAlbum: true,
    })
    expect([...new Set(queued.tracks.map(({ albumId }) => albumId))]).toEqual(
      newest.map(({ id }) => id),
    )
  })

  it('sorts listening history only for the requesting account, and keeps seeded random order stable across pages', () => {
    const airbag = state.ids.get('/music/Radiohead/OK Computer/01 Airbag.flac') ?? 0
    const kid = state.ids.get('/music/Radiohead/Kid A/CD 01/01 Everything.flac') ?? 0
    const { db } = database.get()
    db.prepare('INSERT INTO plays (account_id, media_id, played_at) VALUES (?, ?, ?)').run(
      TEST_ACCOUNTS.a,
      airbag,
      '2026-10-01',
    )
    db.prepare('INSERT INTO plays (account_id, media_id, played_at) VALUES (?, ?, ?)').run(
      TEST_ACCOUNTS.b,
      kid,
      '2026-10-02',
    )
    expect(
      repository().listAlbums({ libraryId: state.library, ...LIST, sort: MUSIC_SORTS.played })[0]
        ?.title,
    ).toBe('OK Computer')
    expect(
      repository().listAlbums({
        libraryId: state.library,
        ...LIST,
        account: TEST_ACCOUNTS.b,
        sort: MUSIC_SORTS.plays,
      })[0]?.title,
    ).toBe('Kid A')
    const options = {
      libraryId: state.library,
      ...LIST,
      sort: MUSIC_SORTS.random,
      seed: 345,
      byAlbum: true,
    }
    const all = repository().listTracks(options)
    const pages = Array.from(
      { length: all.total },
      (_, offset) => repository().listTracks({ ...options, limit: 1, offset }).tracks[0]?.id,
    )
    expect(pages).toEqual(all.tracks.map(({ id }) => id))
    expect([...new Set(all.tracks.map(({ albumId }) => albumId))]).toEqual(
      repository()
        .listAlbums(options)
        .map(({ id }) => id),
    )
  })

  it("answers each album's plays for the calling account alone, wherever albums are listed", () => {
    // The plays the test above made: account a played Airbag, account b Everything in Its Right Place.
    type PlaysOfProps = { account: string }
    const playsOf = ({ account }: PlaysOfProps) =>
      repository()
        .listAlbums({ libraryId: state.library, ...LIST, account })
        .map(({ title, playedAt, plays }) => ({ title, playedAt, plays }))
    expect(playsOf({ account: TEST_ACCOUNTS.a })).toEqual([
      { title: 'Demo Tape', playedAt: null, plays: 0 },
      { title: 'Kid A', playedAt: null, plays: 0 },
      { title: 'OK Computer', playedAt: '2026-10-01', plays: 1 },
    ])
    expect(playsOf({ account: TEST_ACCOUNTS.b })).toEqual([
      { title: 'Demo Tape', playedAt: null, plays: 0 },
      { title: 'Kid A', playedAt: '2026-10-02', plays: 1 },
      { title: 'OK Computer', playedAt: null, plays: 0 },
    ])
    const okComputer = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .find(({ title }) => title === 'OK Computer')
    const id = okComputer?.id ?? 0
    expect(
      repository()
        .albums({ ids: [id], account: TEST_ACCOUNTS.b })
        .get(id)?.plays,
    ).toBe(0)
    expect(repository().albumsInOrder({ ids: [id], account: TEST_ACCOUNTS.a })[0]?.plays).toBe(1)
    expect(repository().album({ id, account: TEST_ACCOUNTS.a })?.album.playedAt).toBe('2026-10-01')
    expect(repository().album({ id, account: TEST_ACCOUNTS.b })?.album).toMatchObject({
      playedAt: null,
      plays: 0,
    })
    // With no account to bind, the album answers no plays at all.
    const unbound = repository().album({ id })?.album
    expect(unbound).not.toHaveProperty('plays')
    expect(unbound).not.toHaveProperty('playedAt')
    const radiohead = okComputer?.artists[0]?.id ?? 0
    type ArtistPlaysProps = { account: string }
    const artistPlays = ({ account }: ArtistPlaysProps) =>
      repository()
        .artist({ id: radiohead, account, seesLibrary: () => true })
        ?.albums.map(({ title, plays }) => ({ title, plays }))
    expect(artistPlays({ account: TEST_ACCOUNTS.b })).toEqual([
      { title: 'OK Computer', plays: 0 },
      { title: 'Kid A', plays: 1 },
      { title: 'Amnesiac', plays: 0 },
    ])
    expect(artistPlays({ account: TEST_ACCOUNTS.a })?.[0]).toEqual({
      title: 'OK Computer',
      plays: 1,
    })
  })

  it('orders a random listing of tracks one track at a time, stable across its pages', () => {
    const options = { libraryId: state.library, ...LIST, sort: MUSIC_SORTS.random, seed: 345 }
    const all = repository().listTracks(options)
    const byTitle = repository().listTracks({ ...options, sort: MUSIC_SORTS.title })
    expect(all.tracks.map(({ id }) => id).toSorted()).toEqual(
      byTitle.tracks.map(({ id }) => id).toSorted(),
    )
    const pages = Array.from(
      { length: all.total },
      (_, offset) => repository().listTracks({ ...options, limit: 1, offset }).tracks[0]?.id,
    )
    expect(pages).toEqual(all.tracks.map(({ id }) => id))
    const byHash = all.tracks
      .map(({ id }) => ({ id, place: (id * (1103515245 + 345 * 2)) % 2147483647 }))
      .toSorted((a, b) => a.place - b.place || a.id - b.id)
      .map(({ id }) => id)
    expect(all.tracks.map(({ id }) => id)).toEqual(byHash)
  })

  it('drops an album with its last file, and a cover that was in a file now gone gives way to the archive', () => {
    const airbag = state.ids.get('/music/Radiohead/OK Computer/01 Airbag.flac') ?? 0
    new MediaIndex(database.get()).remove([airbag])
    repository().prune()
    const okComputer = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .find(({ title }) => title === 'OK Computer')
    // The embedded cover went with the file; the album keeps its tags' release id, so the archive's stands in.
    expect(okComputer).toMatchObject({ trackCount: 1 })
    expect(
      coverStore().cover({ id: okComputer?.id ?? 0, version: okComputer?.coverVersion ?? '' }),
    ).toEqual({ source: COVER_SOURCES.coverArtArchive, ref: 'rel-ok' })
    const paranoid = state.ids.get('/music/Radiohead/OK Computer/02 Paranoid Android.flac') ?? 0
    new MediaIndex(database.get()).remove([paranoid])
    repository().prune()
    expect(
      repository()
        .listAlbums({ libraryId: state.library, ...LIST })
        .map(({ title }) => title),
    ).not.toContain('OK Computer')
    expect(coverStore().keptCovers().albumIds.size).toBe(
      repository().listAlbums({ libraryId: state.library, ...LIST }).length +
        repository().listAlbums({ libraryId: state.other, ...LIST }).length,
    )
  })
})
