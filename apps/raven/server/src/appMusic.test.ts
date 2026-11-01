import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  LIBRARY_KINDS,
  MATCH_STATES,
  MUSIC_SORTS,
  THUMBNAIL_STATES,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeImage, encodeTrack, jpegSize } from '@/test/clips'
import { fakeMusicBrainz } from '@/test/fakeMusicBrainz'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/** MusicBrainz release ids are UUIDs; these name the fake's releases. */
const MBIDS = {
  blur: '11111111-1111-4111-8111-000000000001',
  tribute: '11111111-1111-4111-8111-000000000002',
  okComputer: '11111111-1111-4111-8111-000000000003',
  live: '11111111-1111-4111-8111-000000000004',
  unknown: '11111111-1111-4111-8111-000000000009',
} as const

/** What the fake MusicBrainz knows: Blur's album with a cover in the archive, and a tribute to confuse it. */
const RELEASES = [
  {
    mbid: MBIDS.blur,
    title: 'Blur',
    artist: 'Blur',
    date: '1997-02-10',
    trackCount: 14,
    hasCover: true,
  },
  { mbid: MBIDS.tribute, title: 'Blur', artist: 'A Tribute Band', date: '2005' },
  {
    mbid: MBIDS.okComputer,
    title: 'OK Computer',
    artist: 'Radiohead',
    date: '1997-05-21',
    trackCount: 12,
  },
  { mbid: MBIDS.live, title: 'Live 1994', artist: 'Someone Else', date: '1994' },
]

/** A music library of two tagged albums and one untagged folder, scanned by the real tag reader. */
describe('a music library', () => {
  const state: {
    root: string
    admin: string
    library: number
    app: NestFastifyApplication | null
  } = {
    root: '',
    admin: '',
    library: 0,
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const at = (...parts: string[]) => join(state.root, 'music', ...parts)

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-music-'))
    const cover = join(state.root, 'cover.jpg')
    await encodeImage({ path: cover, size: '300x300' })
    const okComputer = {
      artist: 'Radiohead',
      album: 'OK Computer',
      album_artist: 'Radiohead',
      date: '1997',
      genre: 'Alternative Rock',
      MUSICBRAINZ_ALBUMID: MBIDS.okComputer,
    }
    await encodeTrack({
      path: at('Radiohead', 'OK Computer', '01 Airbag.flac'),
      tags: {
        ...okComputer,
        title: 'Airbag',
        track: '1',
        REPLAYGAIN_TRACK_GAIN: '-6.50 dB',
        REPLAYGAIN_TRACK_PEAK: '0.900000',
        REPLAYGAIN_ALBUM_GAIN: '-7.00 dB',
        REPLAYGAIN_ALBUM_PEAK: '0.950000',
      },
      cover,
    })
    await encodeTrack({
      path: at('Radiohead', 'OK Computer', '02 Paranoid Android.flac'),
      tags: { ...okComputer, title: 'Paranoid Android', track: '2' },
    })
    await encodeTrack({
      path: at('Blur', 'Blur', '02 Song 2.mp3'),
      tags: { artist: 'Blur', album: 'Blur', title: 'Song 2', track: '2', date: '1997' },
    })
    // A folder with no tags at all and a cover beside the files.
    await encodeTrack({ path: at('Bootlegs', 'Live 1994', 'take 1.m4a') })
    await encodeImage({ path: at('Bootlegs', 'Live 1994', 'folder.jpg'), size: '120x120' })
    // A video in the music folder is not a track.
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      metadataFetch: fakeMusicBrainz({ releases: RELEASES, cover: await readFile(cover) }).fetch,
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const library = await api().createLibrary({
      name: 'Music',
      paths: [at()],
      settings: { kind: LIBRARY_KINDS.music },
    })
    state.library = library.id
    await app().get(ScannerService).whenIdle(library.id)
    await app().get(ThumbnailService).whenIdle()
    await app().get(MetadataService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('reads every file with its tags, grabs no frame, and lists it as a file too', async () => {
    const files = await api().listMedia({ libraryId: state.library })
    expect(
      files.map(({ fileName, thumbnail, audioCodec, duration }) => ({
        fileName,
        thumbnail,
        audioCodec,
        isTimed: duration !== null,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          fileName: '01 Airbag.flac',
          thumbnail: THUMBNAIL_STATES.failed,
          audioCodec: 'flac',
          isTimed: true,
        },
        {
          fileName: '02 Song 2.mp3',
          thumbnail: THUMBNAIL_STATES.failed,
          audioCodec: 'mp3',
          isTimed: true,
        },
        {
          fileName: 'take 1.m4a',
          thumbnail: THUMBNAIL_STATES.failed,
          audioCodec: 'aac',
          isTimed: true,
        },
      ]),
    )
    expect(files).toHaveLength(4)
  })

  it('lists the albums with their artists, a cover from the first file that embeds one or the folder', async () => {
    const albums = await api().listAlbums({ libraryId: state.library, sort: MUSIC_SORTS.artist })
    expect(
      albums.map(({ title, artists, year, trackCount, coverVersion }) => ({
        title,
        artists: artists.map(({ name }) => name),
        year,
        trackCount,
        hasCover: coverVersion !== null,
      })),
    ).toEqual([
      // Matched by a search, and given the archive's cover.
      { title: 'Blur', artists: ['Blur'], year: 1997, trackCount: 1, hasCover: true },
      { title: 'Live 1994', artists: ['Bootlegs'], year: null, trackCount: 1, hasCover: true },
      { title: 'OK Computer', artists: ['Radiohead'], year: 1997, trackCount: 2, hasCover: true },
    ])
  })

  it('matches each album to MusicBrainz: by the id in its tags, by a sure search, or not at all', async () => {
    const albums = await api().listAlbums({ libraryId: state.library })
    expect(albums.map(({ title, match }) => `${title}: ${match}`)).toEqual([
      'Blur: matched',
      'Live 1994: unmatched',
      'OK Computer: matched',
    ])
    const blur = await api().getAlbum(albums.find(({ title }) => title === 'Blur')?.id ?? 0)
    expect(blur).toMatchObject({ mbid: MBIDS.blur })
    const cover = api().albumCoverUrl({
      albumId: blur.album.id,
      coverVersion: blur.album.coverVersion,
    })
    const served = await app().inject({ method: 'GET', url: cover ?? '' })
    expect(served.statusCode).toBe(200)
    expect(jpegSize(served.rawPayload)).toEqual({ width: 300, height: 300 })
  })

  it('offers Fix match candidates scored against the album, and takes the pick or none', async () => {
    const albums = await api().listAlbums({ libraryId: state.library })
    const live = albums.find(({ title }) => title === 'Live 1994')
    // Its folder named the artist, so a search by it finds nothing; words of one's own do.
    await expect(api().searchAlbumMatches({ albumId: live?.id ?? 0 })).resolves.toEqual([])
    const candidates = await api().searchAlbumMatches({
      albumId: live?.id ?? 0,
      query: 'Live 1994',
    })
    expect(candidates.map(({ mbid }) => mbid)).toEqual([MBIDS.live])
    expect(candidates[0]?.confidence).toBeLessThan(80)
    const fixed = await api().setAlbumMatch({ albumId: live?.id ?? 0, mbid: MBIDS.live })
    expect(fixed).toMatchObject({
      mbid: MBIDS.live,
      album: { match: MATCH_STATES.manual, year: 1994 },
    })
    const cleared = await api().setAlbumMatch({ albumId: live?.id ?? 0, mbid: null })
    expect(cleared).toMatchObject({ mbid: null, album: { match: MATCH_STATES.manual } })
    await expect(
      api().setAlbumMatch({ albumId: live?.id ?? 0, mbid: MBIDS.unknown }),
    ).rejects.toMatchObject({
      status: 404,
    })
    const retried = await api().matchLibrary(state.library)
    expect(retried.id).toBe(state.library)
  })

  it("serves an album's cover by its capability address, square and scaled, to anyone, and no other version", async () => {
    const albums = await api().listAlbums({ libraryId: state.library })
    const okComputer = albums.find(({ title }) => title === 'OK Computer')
    const live = albums.find(({ title }) => title === 'Live 1994')
    const embedded = api().albumCoverUrl({
      albumId: okComputer?.id ?? 0,
      coverVersion: okComputer?.coverVersion ?? null,
    })
    const beside = api().albumCoverUrl({
      albumId: live?.id ?? 0,
      coverVersion: live?.coverVersion ?? null,
    })
    if (embedded === null || beside === null) throw new Error('No cover addresses')
    const [fromFile, fromFolder, narrow, stale] = await Promise.all([
      app().inject({ method: 'GET', url: embedded }),
      app().inject({ method: 'GET', url: beside }),
      app().inject({ method: 'GET', url: `${embedded}?w=185` }),
      app().inject({ method: 'GET', url: embedded.replace(/[^/]+$/, 'not-the-version') }),
    ])
    expect(fromFile.statusCode).toBe(200)
    expect(jpegSize(fromFile.rawPayload)).toEqual({ width: 300, height: 300 })
    expect(fromFile.headers['cache-control']).toContain('immutable')
    expect(fromFolder.statusCode).toBe(200)
    expect(jpegSize(fromFolder.rawPayload)).toEqual({ width: 120, height: 120 })
    expect(jpegSize(narrow.rawPayload).width).toBe(185)
    expect(stale.statusCode).toBe(404)
  })

  it("gives an album's page its tracks in order with their gains, each playable as the file it is", async () => {
    const albums = await api().listAlbums({ libraryId: state.library })
    const okComputer = albums.find(({ title }) => title === 'OK Computer')
    const details = await api().getAlbum(okComputer?.id ?? 0)
    expect(details).toMatchObject({
      mbid: MBIDS.okComputer,
      genres: ['Alternative Rock'],
      discCount: 1,
      album: { releaseDate: '1997-05-21' },
    })
    expect(
      details.tracks.map(({ number, title, codec, isLossless }) => ({
        number,
        title,
        codec,
        isLossless,
      })),
    ).toEqual([
      { number: 1, title: 'Airbag', codec: 'flac', isLossless: true },
      { number: 2, title: 'Paranoid Android', codec: 'flac', isLossless: true },
    ])
    expect(details.tracks.map(({ gain }) => gain)).toEqual([
      { track: -6.5, album: -7, trackPeak: 0.9, albumPeak: 0.95 },
      { track: null, album: -7, trackPeak: null, albumPeak: 0.95 },
    ])
    const [airbag] = details.tracks
    const media = await api().getMedia(airbag?.id ?? 0)
    expect(media.fileName).toBe('01 Airbag.flac')
    const tracks = await api().getTracks(airbag?.id ?? 0)
    expect(tracks.audio).toHaveLength(1)
  })

  it('lists the artists and pages the tracks', async () => {
    const artists = await api().listArtists({ libraryId: state.library })
    expect(
      artists.map(({ name, albumCount, trackCount }) => `${name} ${albumCount}/${trackCount}`),
    ).toEqual(['Blur 1/1', 'Bootlegs 1/1', 'Radiohead 1/2'])
    const radiohead = artists.find(({ name }) => name === 'Radiohead')
    const page = await api().getArtist(radiohead?.id ?? 0)
    expect(page.albums.map(({ title }) => title)).toEqual(['OK Computer'])
    const first = await api().listTracks({
      libraryId: state.library,
      sort: MUSIC_SORTS.title,
      limit: 2,
    })
    expect(first.total).toBe(4)
    expect(first.tracks.map(({ title }) => title)).toEqual(['Airbag', 'Paranoid Android'])
    const rest = await api().listTracks({
      libraryId: state.library,
      sort: MUSIC_SORTS.title,
      limit: 2,
      offset: 2,
    })
    expect(rest.tracks.map(({ title }) => title)).toEqual(['Song 2', 'take 1'])
  })

  it('falls back from a broken selected cover to another local image and changes its version', async () => {
    const before = (await api().listAlbums({ libraryId: state.library })).find(
      ({ title }) => title === 'Live 1994',
    )
    if (!before) throw new Error('Missing live album')
    await writeFile(at('Bootlegs', 'Live 1994', 'folder.jpg'), 'not an image')
    await encodeImage({ path: at('Bootlegs', 'Live 1994', 'front.jpg'), size: '160x160' })
    const url = api().albumCoverUrl({ albumId: before.id, coverVersion: before.coverVersion })
    const response = await app().inject({ method: 'GET', url: url ?? '' })
    expect(response.statusCode).toBe(200)
    expect(jpegSize(response.rawPayload).width).toBe(160)
    const after = await api().getAlbum(before.id)
    expect(after.album.coverVersion).not.toBe(before.coverVersion)
    const stale = await app().inject({ method: 'GET', url: url ?? '' })
    expect(stale.statusCode).toBe(404)
  })

  it('drops an album and its artist once its last file goes, on the next scan', async () => {
    await rm(at('Blur'), { recursive: true, force: true })
    await api().scanLibrary(state.library)
    await app().get(ScannerService).whenIdle(state.library)
    const albums = await api().listAlbums({ libraryId: state.library })
    expect(albums.map(({ title }) => title)).toEqual(['Live 1994', 'OK Computer'])
    const artists = await api().listArtists({ libraryId: state.library })
    expect(artists.map(({ name }) => name)).toEqual(['Bootlegs', 'Radiohead'])
  })
})
