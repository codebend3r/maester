import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { type ApiClient, LIBRARY_KINDS, MUSIC_SORTS, THUMBNAIL_STATES } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeImage, encodeTrack, jpegSize } from '@/test/clips'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

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
      MUSICBRAINZ_ALBUMID: 'rel-ok',
    }
    await encodeTrack({
      path: at('Radiohead', 'OK Computer', '01 Airbag.flac'),
      tags: { ...okComputer, title: 'Airbag', track: '1' },
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
      { title: 'Blur', artists: ['Blur'], year: 1997, trackCount: 1, hasCover: false },
      { title: 'Live 1994', artists: ['Bootlegs'], year: null, trackCount: 1, hasCover: true },
      { title: 'OK Computer', artists: ['Radiohead'], year: 1997, trackCount: 2, hasCover: true },
    ])
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

  it("gives an album's page its tracks in order, each playable as the file it is", async () => {
    const albums = await api().listAlbums({ libraryId: state.library })
    const okComputer = albums.find(({ title }) => title === 'OK Computer')
    const details = await api().getAlbum(okComputer?.id ?? 0)
    expect(details).toMatchObject({ mbid: 'rel-ok', genres: ['Alternative Rock'], discCount: 1 })
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
