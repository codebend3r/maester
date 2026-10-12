import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Logger } from '@nestjs/common'
import { type LibraryKind } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { ImageCache } from '@/metadata/imageCache'
import { ItemPictures } from '@/metadata/itemPictures'
import { MatchFiles } from '@/metadata/matchFiles'
import { createMatchers } from '@/metadata/matchers'
import { MatchPass } from '@/metadata/matchPass'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { OmdbClient } from '@/metadata/omdbClient'
import { OmdbScores } from '@/metadata/omdbScores'
import { TmdbClient } from '@/metadata/tmdbClient'
import { SettingsRepository } from '@/settings/settingsRepository'
import { encodeImage } from '@/test/clips'
import { testDatabase } from '@/test/database'
import { fakeTmdb } from '@/test/fakeTmdb'

describe('matching by library type', () => {
  const database = testDatabase('raven-matchers-')
  const tmdb = fakeTmdb({
    movies: [{ id: 949, title: 'Heat', released: '1995-12-15' }],
    shows: [
      {
        id: 95396,
        title: 'Severance',
        first: '2022-02-18',
        seasons: {
          1: [
            { number: 1, title: 'Good News About Hell', aired: '2022-02-18' },
            { number: 2, title: 'Half Loop', aired: '2022-02-18' },
          ],
        },
      },
    ],
  })
  const state = { paths: new Map<string, number>(), libraries: new Map<string, number>() }

  const services = () => {
    const config = {
      ...readServerConfig({}),
      dataDir: database.dir(),
      tmdbApiToken: 'test-token',
      hwAccel: 'none' as const,
    }
    const metadata = new MetadataRepository(database.get())
    const files = new MatchFiles(database.get(), metadata)
    const ffmpeg = new FfmpegService(config, new SettingsRepository(database.get()))
    const pictures = new ItemPictures(metadata, files, new ImageCache(config, tmdb.fetch, ffmpeg))
    const pass = () =>
      new MatchPass({
        tmdb: new TmdbClient(config, tmdb.fetch),
        metadata,
        files,
        scores: new OmdbScores(metadata, new OmdbClient(config, tmdb.fetch)),
        logger: new Logger('MatchersTest'),
      })
    return { metadata, files, pass, matchers: createMatchers({ files, metadata, pictures }) }
  }

  /** The file indexed at `path` under a library's root. */
  const fileAt = (path: string) => {
    const id = state.paths.get(path)
    const found = id == null ? null : services().files.byId(id)
    if (!found) throw new Error(`No file at ${path}`)
    return found
  }

  const library = ({ name, kind }: { name: string; kind: LibraryKind }) => {
    const root = join(database.dir(), name)
    const id = new LibrariesRepository(database.get()).create({
      name,
      paths: [root],
      settings: { kind },
    }).id
    state.libraries.set(name, id)
    return { root, id, kind }
  }

  const put = async ({
    lib,
    files,
    pictures = [],
  }: {
    lib: { root: string; id: number; kind: LibraryKind }
    files: readonly string[]
    pictures?: readonly string[]
  }) => {
    const index = new MediaIndex(database.get())
    await Promise.all([
      ...files.map(async (path) => {
        const full = join(lib.root, path)
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, '')
      }),
      ...pictures.map((path) => encodeImage({ path: join(lib.root, path) })),
    ])
    files.forEach((path) =>
      state.paths.set(
        `${lib.root}/${path}`,
        index.insert({
          libraryId: lib.id,
          kind: lib.kind,
          file: { path: join(lib.root, path), root: lib.root, size: 1, mtimeMs: 1 },
        }),
      ),
    )
  }

  beforeAll(async () => {
    await database.open()
    const films = library({ name: 'Films', kind: 'movies' })
    const uhd = library({ name: 'Films 4K', kind: 'movies' })
    const tv = library({ name: 'Shows', kind: 'shows' })
    await put({
      lib: films,
      files: ['Heat (1995)/Heat (1995).mkv', 'Heat (1995)/Featurettes/Making Of.mkv'],
      pictures: ['Heat (1995)/poster.jpg'],
    })
    await put({ lib: uhd, files: ['Heat (1995)/Heat (1995) 2160p.mkv'] })
    await put({
      lib: tv,
      files: [
        'Severance/Season 01/Severance - S01E01.mkv',
        'Severance/Season 01/Severance - S01E01 2160p.mkv',
        'Severance/Season 01/Severance - S01E02.mkv',
        'Severance/Featurettes/Making Of.mkv',
      ],
      pictures: ['Severance/Season 01/Severance - S01E01-thumb.jpg'],
    })
  })

  afterAll(database.close)

  const under = (name: string, path: string) => fileAt(`${join(database.dir(), name)}/${path}`)

  it('matches movie files one by one, and a show folder as one', () => {
    const { matchers } = services()
    const heat = under('Films', 'Heat (1995)/Heat (1995).mkv')
    const extra = under('Films', 'Heat (1995)/Featurettes/Making Of.mkv')
    expect(matchers.movie.groups([heat, extra])).toEqual([[heat], [extra]])
    const first = under('Shows', 'Severance/Season 01/Severance - S01E01.mkv')
    const second = under('Shows', 'Severance/Season 01/Severance - S01E02.mkv')
    expect(matchers.show.groups([first, second])).toEqual([[first, second]])
  })

  it('keeps a Fix match for a folder of one movie, or for a whole show folder', () => {
    const { matchers } = services()
    const heat = matchers.movie.fixGroup(under('Films', 'Heat (1995)/Heat (1995).mkv'))
    expect(heat.place).toBe('Heat (1995)')
    expect(heat.files.map((file) => file.fileName)).toEqual(['Heat (1995).mkv'])
    const show = matchers.show.fixGroup(
      under('Shows', 'Severance/Season 01/Severance - S01E01.mkv'),
    )
    expect(show.place).toBe('Severance')
    expect(show.files).toHaveLength(4)
  })

  it('keeps the poster beside one copy of a movie when another library has a copy without one', async () => {
    const { metadata, matchers, pass } = services()
    const heat = under('Films', 'Heat (1995)/Heat (1995).mkv')
    const uhd = under('Films 4K', 'Heat (1995)/Heat (1995) 2160p.mkv')
    const poster = join(database.dir(), 'Films', 'Heat (1995)', 'poster.jpg')

    await matchers.movie.match({ files: [heat], pass: pass() })
    const itemId = metadata.find({ type: 'movie', tmdbId: '949' })?.id ?? -1
    expect(metadata.image({ itemId, kind: 'poster' })).toEqual({ source: 'local', ref: poster })

    // The copy in the other library, matched in a later pass, has no poster of its own.
    await matchers.movie.match({ files: [uhd], pass: pass() })
    expect(metadata.mediaUnder(itemId).toSorted()).toEqual([heat.id, uhd.id].toSorted())
    expect(metadata.image({ itemId, kind: 'poster' })).toEqual({ source: 'local', ref: poster })
  })

  it('places a show folder: extras off, and the still kept whichever version comes last', async () => {
    const { metadata, files, matchers, pass } = services()
    const thumbed = under('Shows', 'Severance/Season 01/Severance - S01E01.mkv')
    const plain = under('Shows', 'Severance/Season 01/Severance - S01E01 2160p.mkv')
    const second = under('Shows', 'Severance/Season 01/Severance - S01E02.mkv')
    const extra = under('Shows', 'Severance/Featurettes/Making Of.mkv')
    const still = join(
      database.dir(),
      'Shows',
      'Severance',
      'Season 01',
      'Severance - S01E01-thumb.jpg',
    )

    await matchers.show.match({ files: [thumbed, plain, second, extra], pass: pass() })
    expect(
      files.byIds([thumbed.id, plain.id, second.id, extra.id]).map((file) => file.match),
    ).toEqual(['matched', 'matched', 'matched', 'off'])
    const showId = metadata.find({ type: 'show', tmdbId: '95396' })?.id ?? -1
    const seasonId = metadata.child({ parentId: showId, number: 1 })?.id ?? -1
    const episodeId = metadata.child({ parentId: seasonId, number: 1 })?.id ?? -1
    expect(metadata.mediaUnder(episodeId).toSorted()).toEqual([thumbed.id, plain.id].toSorted())
    expect(metadata.image({ itemId: episodeId, kind: 'still' })).toEqual({
      source: 'local',
      ref: still,
    })

    // Matching the version without a still again keeps the other's.
    files.reset([plain.id])
    await matchers.show.match({ files: [plain], pass: pass() })
    expect(metadata.image({ itemId: episodeId, kind: 'still' })).toEqual({
      source: 'local',
      ref: still,
    })
  })
})
