import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  LIBRARY_KINDS,
  LYRICS_KINDS,
  LYRICS_SOURCES,
  NO_LYRICS,
  PLAYLIST_LIMITS,
  type Track,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, ROUTE_METHODS, adminCookie, testConfig } from '@/test/app'
import { addChapters, encodeTrack } from '@/test/clips'
import { LRCLIB_HOST, fakeLrclib } from '@/test/fakeLrclib'
import { fakeMusicBrainz } from '@/test/fakeMusicBrainz'
import { apiFor } from '@/test/server'

const TITLES = {
  tagged: 'Tagged',
  sidecar: 'Beside',
  found: 'Found',
  missing: 'Nowhere',
  outage: 'Later',
  gone: 'Gone',
} as const

const LRC = {
  tagged: '[00:01.00]Sung from the tag',
  sidecar: '[00:00.50]Sung from the sidecar\n[00:01.50]And on',
  found: '[00:01.00]Sung from LRCLIB',
} as const

/** A music library whose tracks each find their lyrics in another place, and an audiobook with chapters. */
describe('playlists, favourites, lyrics and chapters', () => {
  const lrclib = fakeLrclib({ records: [{ title: TITLES.found, synced: LRC.found }] })
  const musicBrainz = fakeMusicBrainz({ releases: [] })
  const state: {
    root: string
    admin: string
    music: number
    books: number
    app: NestFastifyApplication | null
  } = { root: '', admin: '', music: 0, books: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)

  /** Every track of the music library, by title. */
  const tracks = async (): Promise<Record<string, Track>> => {
    const { tracks: listed } = await api().listTracks({ libraryId: state.music, limit: 100 })
    return Object.fromEntries(listed.map((track) => [track.title, track]))
  }

  type TrackIdProps = { title: string }

  const trackId = async ({ title }: TrackIdProps): Promise<number> =>
    (await tracks())[title]?.id ?? 0

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-music-viewing-'))
    const album = { artist: 'Band', album_artist: 'Band', album: 'Words' }
    await encodeTrack({
      path: at('Music', 'Band', 'Words', '01 Tagged.flac'),
      tags: { ...album, title: TITLES.tagged, track: '1', lyrics: LRC.tagged },
    })
    await encodeTrack({
      path: at('Music', 'Band', 'Words', '02 Beside.mp3'),
      tags: { ...album, title: TITLES.sidecar, track: '2' },
    })
    await writeFile(at('Music', 'Band', 'Words', '02 Beside.lrc'), LRC.sidecar)
    await Promise.all(
      [TITLES.found, TITLES.missing, TITLES.outage, TITLES.gone].map((title, index) =>
        encodeTrack({
          path: at('Music', 'Band', 'Words', `0${index + 3} ${title}.mp3`),
          tags: { ...album, title, track: String(index + 3) },
        }),
      ),
    )
    const book = at('Books', 'A Story.m4a')
    await encodeTrack({ path: book, seconds: 6 })
    await addChapters({
      path: book,
      chapters: [
        { start: 0, end: 2, title: 'Opening Words' },
        { start: 2, end: 6, title: 'The Rest' },
      ],
    })
    const fetch: MetadataFetch = (request) =>
      new URL(request.url).host === LRCLIB_HOST ? lrclib.fetch(request) : musicBrainz.fetch(request)
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      metadataFetch: fetch,
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const music = await api().createLibrary({
      name: 'Music',
      paths: [at('Music')],
      settings: { kind: LIBRARY_KINDS.music },
    })
    const books = await api().createLibrary({
      name: 'Books',
      paths: [at('Books')],
      settings: { kind: LIBRARY_KINDS.audiobooks },
    })
    state.music = music.id
    state.books = books.id
    await app().get(ScannerService).whenIdle(music.id)
    await app().get(ScannerService).whenIdle(books.id)
    await app().get(MetadataService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('makes, fills, orders, renames and deletes a playlist', async () => {
    const byTitle = await tracks()
    const [one, two, three] = [TITLES.tagged, TITLES.sidecar, TITLES.found].map(
      (title) => byTitle[title]?.id ?? 0,
    )
    const made = await api().createPlaylist({ name: '  Road trip  ' })
    expect(made.playlist).toMatchObject({ name: 'Road trip', trackCount: 0, duration: 0 })
    expect(made.tracks).toEqual([])
    const { id } = made.playlist

    const filled = await api().appendPlaylistTracks({ id, mediaIds: [one, two] })
    const again = await api().appendPlaylistTracks({ id, mediaIds: [one] })
    expect(filled.tracks.map((track) => track.id)).toEqual([one, two])
    expect(again.tracks.map((track) => track.id)).toEqual([one, two, one])
    expect(again.playlist.trackCount).toBe(3)
    expect(again.playlist.duration).toBeGreaterThan(5)
    expect(again.tracks[0]).toMatchObject({ title: TITLES.tagged, album: { title: 'Words' } })

    const ordered = await api().replacePlaylistTracks({ id, mediaIds: [three, one] })
    expect(ordered.tracks.map((track) => track.id)).toEqual([three, one])
    const renamed = await api().renamePlaylist({ id, name: 'Drive' })
    expect(renamed.playlist.name).toBe('Drive')
    expect(
      (await api().listPlaylists()).map(({ name, trackCount }) => ({ name, trackCount })),
    ).toEqual([{ name: 'Drive', trackCount: 2 }])

    await api().deletePlaylist(id)
    expect(await api().listPlaylists()).toEqual([])
    await expect(api().getPlaylist(id)).rejects.toMatchObject({ status: 404 })
    await expect(api().deletePlaylist(id)).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a body it cannot read, and an id that is no track', async () => {
    const { id } = (await api().createPlaylist({ name: 'Checks' })).playlist
    const refused = await Promise.all(
      [
        { method: ROUTE_METHODS.post, url: '/api/playlists', payload: { name: '   ' } },
        {
          method: ROUTE_METHODS.post,
          url: '/api/playlists',
          payload: { name: 'x'.repeat(PLAYLIST_LIMITS.name + 1) },
        },
        { method: ROUTE_METHODS.put, url: `/api/playlists/${id}`, payload: {} },
        {
          method: ROUTE_METHODS.post,
          url: `/api/playlists/${id}/tracks`,
          payload: { mediaIds: [1.5] },
        },
        {
          method: ROUTE_METHODS.put,
          url: `/api/playlists/${id}/tracks`,
          payload: { mediaIds: Array.from({ length: PLAYLIST_LIMITS.tracks + 1 }, () => 1) },
        },
      ].map(
        async ({ method, url, payload }) =>
          (await app().inject({ method, url, payload, headers: { cookie: state.admin } }))
            .statusCode,
      ),
    )
    expect(refused).toEqual([400, 400, 400, 400, 400])
    await expect(api().appendPlaylistTracks({ id, mediaIds: [999_999] })).rejects.toMatchObject({
      status: 404,
    })
    expect((await api().getPlaylist(id)).tracks).toEqual([])
    await api().deletePlaylist(id)
  })

  it('drops a track from every playlist when its file goes', async () => {
    const id = await trackId({ title: TITLES.gone })
    const { playlist } = await api().createPlaylist({ name: 'Gone' })
    await api().appendPlaylistTracks({ id: playlist.id, mediaIds: [id] })
    await api().deleteMedia(id)
    expect((await api().getPlaylist(playlist.id)).playlist.trackCount).toBe(0)
    await api().deletePlaylist(playlist.id)
  })

  it('marks albums and artists favourites, lists them, and says so on their pages', async () => {
    const [album] = await api().listAlbums({ libraryId: state.music })
    const [artist] = album?.artists ?? []
    const albumId = album?.id ?? 0
    const artistId = artist?.id ?? 0
    expect((await api().getAlbum(albumId)).isFavourite).toBe(false)
    expect((await api().setAlbumFavourite({ albumId, favourite: true })).isFavourite).toBe(true)
    expect((await api().setArtistFavourite({ artistId, favourite: true })).isFavourite).toBe(true)
    expect((await api().getArtist(artistId)).isFavourite).toBe(true)
    expect((await api().listFavouriteAlbums()).map(({ id }) => id)).toEqual([albumId])
    expect(
      (await api().listFavouriteArtists()).map(({ id, albumCount }) => ({ id, albumCount })),
    ).toEqual([{ id: artistId, albumCount: 1 }])
    expect((await api().setAlbumFavourite({ albumId, favourite: false })).isFavourite).toBe(false)
    await api().setArtistFavourite({ artistId, favourite: false })
    expect(await api().listFavouriteAlbums()).toEqual([])
    expect(await api().listFavouriteArtists()).toEqual([])
    await expect(
      api().setAlbumFavourite({ albumId: 999_999, favourite: true }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      api().setArtistFavourite({ artistId: 999_999, favourite: true }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it("reads a track's lyrics from its tag, then a sidecar, then LRCLIB, which it asks once", async () => {
    const byTitle = await tracks()
    const lyricsOf = (title: string) => api().getLyrics(byTitle[title]?.id ?? 0)
    expect(await lyricsOf(TITLES.tagged)).toEqual({
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.tags,
      lines: [{ at: 1, text: 'Sung from the tag' }],
    })
    expect(await lyricsOf(TITLES.sidecar)).toEqual({
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.sidecar,
      lines: [
        { at: 0.5, text: 'Sung from the sidecar' },
        { at: 1.5, text: 'And on' },
      ],
    })
    expect(lrclib.requests).toEqual([])

    const found = {
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.lrclib,
      lines: [{ at: 1, text: 'Sung from LRCLIB' }],
    }
    expect(await lyricsOf(TITLES.found)).toEqual(found)
    expect(await lyricsOf(TITLES.found)).toEqual(found)
    expect(await lyricsOf(TITLES.missing)).toEqual(NO_LYRICS)
    expect(await lyricsOf(TITLES.missing)).toEqual(NO_LYRICS)
    expect(lrclib.requests.map(({ query }) => query)).toEqual([
      { artist_name: 'Band', track_name: TITLES.found, album_name: 'Words', duration: '2' },
      { artist_name: 'Band', track_name: TITLES.missing, album_name: 'Words', duration: '2' },
    ])
    expect(lrclib.requests[0]?.userAgent ?? null).toMatch(/^raven\/\S+ \(https:\/\/github\.com\//)
    await expect(api().getLyrics(999_999)).rejects.toMatchObject({ status: 404 })
  })

  it('asks LRCLIB again after an outage, which it does not keep as an answer', async () => {
    const id = await trackId({ title: TITLES.outage })
    const asked = lrclib.requests.length
    lrclib.setDown({ isDown: true })
    expect(await api().getLyrics(id)).toEqual(NO_LYRICS)
    lrclib.setDown({ isDown: false })
    expect(await api().getLyrics(id)).toEqual(NO_LYRICS)
    expect(await api().getLyrics(id)).toEqual(NO_LYRICS)
    expect(lrclib.requests).toHaveLength(asked + 2)
  })

  it("serves an audiobook's chapters with its markers, and keeps its place", async () => {
    const [book] = await api().listMedia({ libraryId: state.books })
    const id = book?.id ?? 0
    const { chapters } = await api().getMarkers(id)
    expect(chapters.map(({ start, title }) => ({ start, title }))).toEqual([
      { start: 0, title: 'Opening Words' },
      { start: 2, title: 'The Rest' },
    ])
    expect(chapters[1]?.end ?? null).toBeCloseTo(6, 0)
    expect((await api().getLibrary(state.books)).settings.saveProgress).toBe(true)
    await api().saveProgress({ id, position: 3, audio: null })
    expect((await api().getMedia(id)).position).toBe(3)
  })
})
