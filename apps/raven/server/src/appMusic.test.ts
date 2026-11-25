import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  LIBRARY_KINDS,
  MATCH_FACTS,
  MATCH_STATES,
  MUSIC_SORTS,
  NOTIFICATION_TONES,
  SHELF_ORDERS,
  SORT_DIRECTIONS,
  THUMBNAIL_STATES,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { MetadataService } from '@/metadata/metadataService'
import type { AiExplanation } from '@/music/albumClaude'
import { AlbumDiagnoses } from '@/music/albumDiagnoses'
import { MusicMatchStore } from '@/music/musicMatchStore'
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

// A music library of two tagged albums and one untagged folder, scanned by the real tag reader.
describe('a music library', () => {
  const state: {
    root: string
    admin: string
    library: number
    app: NestFastifyApplication | null
    /** Called before each MusicBrainz request, to look at the library while a pass searches. */
    onRequest: () => void
  } = {
    root: '',
    admin: '',
    library: 0,
    app: null,
    onRequest: () => undefined,
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
    const musicBrainz = fakeMusicBrainz({ releases: RELEASES, cover: await readFile(cover) })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      metadataFetch: async (request) => {
        state.onRequest()
        return musicBrainz.fetch(request)
      },
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

  it('dates each album by its newest file on disk and answers its plays, on the listing, the album and the artist', async () => {
    const albums = await api().listAlbums({ libraryId: state.library, sort: MUSIC_SORTS.modified })
    expect(albums).toHaveLength(3)
    const stamps = albums.map(({ modifiedAt }) => Date.parse(modifiedAt ?? ''))
    expect(stamps.every(Number.isFinite)).toBe(true)
    expect(stamps).toEqual(stamps.toSorted((a, b) => b - a))
    // Nothing is played yet, and the server answers the plays of the caller's account.
    expect(albums.map(({ playedAt, plays }) => ({ playedAt, plays }))).toEqual(
      albums.map(() => ({ playedAt: null, plays: 0 })),
    )
    const [first] = albums
    const page = await api().getAlbum(first?.id ?? 0)
    expect(page.album.modifiedAt).toBe(first?.modifiedAt)
    const artist = await api().getArtist(page.album.artists[0]?.id ?? 0)
    expect(artist.albums.find(({ id }) => id === first?.id)?.modifiedAt).toBe(first?.modifiedAt)
  })

  it("gives Home one shelf of the music library's albums, the one added last first", async () => {
    const [shelf, ...rest] = await api().getHomeAlbums()
    const added = await api().listAlbums({
      libraryId: state.library,
      sort: MUSIC_SORTS.added,
      order: SORT_DIRECTIONS.descending,
    })
    expect(rest).toEqual([])
    expect(shelf?.libraryId).toBe(state.library)
    expect(shelf?.albums.map(({ id }) => id)).toEqual(added.map(({ id }) => id))
    expect(shelf?.albums.length).toBeGreaterThan(1)
  })

  it("gives Home the music library's newest releases first for ?order=released", async () => {
    const [shelf] = await api().getHomeAlbums({ order: SHELF_ORDERS.released })
    const released = await api().listAlbums({
      libraryId: state.library,
      sort: MUSIC_SORTS.release,
      order: SORT_DIRECTIONS.descending,
    })
    expect(shelf?.albums.map(({ id }) => id)).toEqual(released.map(({ id }) => id))
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

  it('smart matches the unmatched albums in the background, telling the caller of each as a notification', async () => {
    const { db } = app().get(DatabaseService)
    const matchOfLive = db.prepare<[string], { match: string }>(
      'SELECT match FROM albums WHERE title = ?',
    )
    const seen: string[] = []
    state.onRequest = () => {
      seen.push(matchOfLive.get('Live 1994')?.match ?? '')
    }
    const started = await api().smartMatchAlbums(state.library)
    expect(started).toEqual({ albums: 1 })
    await app().get(MetadataService).whenIdle()
    state.onRequest = () => undefined
    // Searched again where it stands, so the Unmatched albums tab keeps it until a release is found.
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen)).toEqual(new Set([MATCH_STATES.unmatched]))
    const notices = await api().listNotifications()
    expect(notices.map(({ message, tone }) => ({ message, tone }))).toEqual([
      {
        message: 'Smart match is done: 0 of 1 album matched.',
        tone: NOTIFICATION_TONES.info,
      },
      {
        message: 'No MusicBrainz release found for "Live 1994". Fix match can set it by hand.',
        tone: NOTIFICATION_TONES.info,
      },
    ])
    const albums = await api().listAlbums({ libraryId: state.library })
    expect(albums.find(({ title }) => title === 'Live 1994')?.match).toBe(MATCH_STATES.unmatched)
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

  it('says why an album matched or not: the closest release, each fact weighed against it, and no summary without AI', async () => {
    const albums = await api().listAlbums({ libraryId: state.library })
    const blur = albums.find(({ title }) => title === 'Blur')
    const live = albums.find(({ title }) => title === 'Live 1994')
    const diagnosis = await api().getAlbumMatchDiagnosis(blur?.id ?? 0)
    expect(diagnosis.closest).toMatchObject({ mbid: MBIDS.blur, title: 'Blur', artist: 'Blur' })
    expect(diagnosis).toMatchObject({ reason: null, fix: null })
    expect(
      diagnosis.facts.map(({ fact, points, most, album, release }) => ({
        fact,
        points,
        most,
        album,
        release,
      })),
    ).toEqual([
      { fact: MATCH_FACTS.title, points: 45, most: 45, album: 'Blur', release: 'Blur' },
      { fact: MATCH_FACTS.artist, points: 30, most: 30, album: 'Blur', release: 'Blur' },
      { fact: MATCH_FACTS.year, points: 10, most: 10, album: '1997', release: '1997' },
      { fact: MATCH_FACTS.trackCount, points: 0, most: 10, album: '1', release: '14' },
      { fact: MATCH_FACTS.official, points: 5, most: 5, album: null, release: null },
    ])
    // Its folder's name finds the release, though its tags name no title to weigh.
    const bootleg = await api().getAlbumMatchDiagnosis(live?.id ?? 0)
    expect(bootleg.closest?.mbid).toBe(MBIDS.live)
    expect(bootleg.facts.find(({ fact }) => fact === MATCH_FACTS.title)).toMatchObject({
      points: 45,
      release: 'Live 1994',
    })
    await expect(api().getAlbumMatchDiagnosis(999_999)).rejects.toMatchObject({ status: 404 })
  })

  it('keeps a diagnosis smart match explained until the tags change, and asks again for one it could not', async () => {
    const live = (await api().listAlbums({ libraryId: state.library })).find(
      ({ title }) => title === 'Live 1994',
    )
    const album = app()
      .get(MusicMatchStore)
      .albumToMatch(live?.id ?? 0)
    if (album === null) throw new Error('no album')
    const asks = { searches: 0, explanations: 0 }
    const diagnosesWith = (explained: AiExplanation | null) =>
      new AlbumDiagnoses(
        app().get(DatabaseService),
        {
          closest: async () => {
            asks.searches += 1
            return []
          },
        },
        {
          explain: async () => {
            asks.explanations += 1
            return explained
          },
        },
      )
    const unexplained = diagnosesWith(null)
    await unexplained.diagnose(album)
    await unexplained.diagnose(album)
    expect(asks).toEqual({ searches: 2, explanations: 2 })
    const explained = diagnosesWith({ reason: 'Nothing found.', fix: 'Name the artist.' })
    const first = await explained.diagnose(album)
    expect(first).toEqual({
      closest: null,
      facts: [],
      reason: 'Nothing found.',
      fix: 'Name the artist.',
    })
    // Kept in the database, so another instance, as after a restart, answers it too.
    await expect(diagnosesWith(null).diagnose(album)).resolves.toEqual(first)
    expect(asks).toEqual({ searches: 3, explanations: 3 })
    await explained.diagnose({ ...album, year: 1990 })
    expect(asks).toEqual({ searches: 4, explanations: 4 })
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

  it('lists the album artists, each with their albums and the tracks on them, and pages the tracks', async () => {
    const artists = await api().listArtists({ libraryId: state.library })
    // Bootlegs is credited on the untagged track alone once its album is matched to Someone Else's release.
    expect(
      artists.map(({ name, albumCount, trackCount }) => `${name} ${albumCount}/${trackCount}`),
    ).toEqual(['Blur 1/1', 'Radiohead 1/2', 'Someone Else 1/1'])
    expect(
      (await api().listArtists({ libraryId: state.library, search: 'radio' })).map(
        ({ name }) => name,
      ),
    ).toEqual(['Radiohead'])
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

  it('counts the Albums, Artists and Unmatched albums tabs as they list, without reading the listings', async () => {
    const { db } = app().get(DatabaseService)
    const live = (await api().listAlbums({ libraryId: state.library })).find(
      ({ title }) => title === 'Live 1994',
    )
    const setMatch = db.prepare('UPDATE albums SET match = ? WHERE id = ?')
    setMatch.run(MATCH_STATES.unmatched, live?.id ?? 0)
    const albums = await api().listAlbums({ libraryId: state.library })
    const artists = await api().listArtists({ libraryId: state.library })
    expect(await api().getLibraryCounts(state.library)).toMatchObject({
      albums: 3,
      artists: 3,
      unmatchedAlbums: 1,
    })
    expect(albums).toHaveLength(3)
    expect(artists).toHaveLength(3)
    expect(albums.filter(({ match }) => match === MATCH_STATES.unmatched)).toHaveLength(1)
    setMatch.run(live?.match ?? MATCH_STATES.pending, live?.id ?? 0)
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
