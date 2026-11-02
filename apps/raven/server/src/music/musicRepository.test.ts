import { LIBRARY_KINDS, MUSIC_SORTS, type MusicSort, musicListQuery } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import type { AudioFormat, AudioTags } from '@/music/audioReader'
import { COVER_SOURCES, MusicRepository } from '@/music/musicRepository'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, pictureVersionsOf } from '@/test/repositories'

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

  it('lists the artists credited in the library, with how many of its albums and tracks are theirs', () => {
    expect(
      repository()
        .listArtists({ libraryId: state.library, ...LIST })
        .map(({ name, albumCount, trackCount }) => ({ name, albumCount, trackCount })),
    ).toEqual([
      { name: 'Guest Singer', albumCount: 0, trackCount: 1 },
      { name: 'Radiohead', albumCount: 2, trackCount: 4 },
      // Filed by its folder, the folder above is its album's artist.
      { name: 'Unknown Band', albumCount: 1, trackCount: 1 },
    ])
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
      repository().artistPicture({
        id: radiohead?.id ?? 0,
        version: radiohead?.photoVersion ?? '',
      }),
    ).toEqual({ mbid: 'artist-radiohead', picture: null, isFetched: false })
    const picture = 'https://commons.wikimedia.org/radiohead.jpg'
    repository().setArtistPicture({ id: radiohead?.id ?? 0, picture })
    expect(
      repository().artistPicture({
        id: radiohead?.id ?? 0,
        version: radiohead?.photoVersion ?? '',
      }),
    ).toEqual({ mbid: 'artist-radiohead', picture, isFetched: true })
    expect(repository().artistPicture({ id: radiohead?.id ?? 0, version: 'wrong' })).toBeNull()
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
    const details = repository().album(okComputer?.id ?? 0)
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
    const twoDiscs = repository().album(kidA?.id ?? 0)
    expect(twoDiscs?.discCount).toBe(2)
    expect(twoDiscs?.tracks.map(({ artists }) => artists.map(({ name }) => name))).toEqual([
      ['Radiohead'],
      ['Radiohead', 'Guest Singer'],
    ])
    expect(repository().album(999)).toBeNull()
  })

  it('gives an artist’s page their albums across libraries, and what they appear on, hiding libraries the caller may not see', () => {
    const radiohead = repository()
      .listArtists({ libraryId: state.library, ...LIST })
      .find(({ name }) => name === 'Radiohead')
    const page = repository().artist({ id: radiohead?.id ?? 0, seesLibrary: () => true })
    expect(page?.albums.map(({ title }) => title)).toEqual(['OK Computer', 'Kid A', 'Amnesiac'])
    expect(page?.appearsOn).toEqual([])
    expect(page?.artist).toMatchObject({ name: 'Radiohead', albumCount: 3, trackCount: 5 })
    const hidden = repository().artist({
      id: radiohead?.id ?? 0,
      seesLibrary: (libraryId) => libraryId !== state.other,
    })
    expect(hidden?.albums.map(({ title }) => title)).toEqual(['OK Computer', 'Kid A'])
    expect(hidden?.artist.albumCount).toBe(2)
    const guest = repository()
      .listArtists({ libraryId: state.library, ...LIST })
      .find(({ name }) => name === 'Guest Singer')
    const guestPage = repository().artist({ id: guest?.id ?? 0, seesLibrary: () => true })
    expect(guestPage?.albums).toEqual([])
    expect(guestPage?.appearsOn.map(({ title }) => title)).toEqual(['Kid A'])
    expect(repository().artist({ id: 999, seesLibrary: () => true })).toBeNull()
  })

  it('finds an album’s cover by its current version and no other, in the file that embeds it', () => {
    const okComputer = repository()
      .listAlbums({ libraryId: state.library, ...LIST })
      .find(({ title }) => title === 'OK Computer')
    const version = okComputer?.coverVersion ?? ''
    expect(repository().cover({ id: okComputer?.id ?? 0, version })).toEqual({
      source: COVER_SOURCES.embedded,
      ref: String(state.ids.get('/music/Radiohead/OK Computer/01 Airbag.flac')),
    })
    expect(repository().cover({ id: okComputer?.id ?? 0, version: 'stale' })).toBeNull()
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
    expect(repository().cover({ id: demo()?.id ?? 0, version })).toEqual({
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
    const artists = repository().listArtists({ libraryId: state.library, ...LIST })
    expect(artists.filter(({ name }) => name === 'Unknown Band')).toMatchObject([
      { mbid: 'band-1' },
    ])
  })

  it('keeps a file in its folder album when its tags change, and refreshes track credits', () => {
    const path = '/music/Radiohead/Kid A/CD 02/01 Guest.flac'
    const id = state.ids.get(path) ?? 0
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
        .listArtists({ libraryId: state.library, ...LIST })
        .map(({ name }) => name),
    ).not.toContain('Guest Singer')
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
      repository().cover({ id: okComputer?.id ?? 0, version: okComputer?.coverVersion ?? '' }),
    ).toEqual({ source: COVER_SOURCES.coverArtArchive, ref: 'rel-ok' })
    const paranoid = state.ids.get('/music/Radiohead/OK Computer/02 Paranoid Android.flac') ?? 0
    new MediaIndex(database.get()).remove([paranoid])
    repository().prune()
    expect(
      repository()
        .listAlbums({ libraryId: state.library, ...LIST })
        .map(({ title }) => title),
    ).not.toContain('OK Computer')
    expect(repository().keptCovers().albumIds.size).toBe(
      repository().listAlbums({ libraryId: state.library, ...LIST }).length +
        repository().listAlbums({ libraryId: state.other, ...LIST }).length,
    )
  })
})
