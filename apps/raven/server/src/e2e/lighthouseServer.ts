import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { FIXTURE_SERVER, LIBRARY_KINDS, type ApiClient } from '@raven/core'
import { HEADERS } from '@shared/server'
import { type FixtureFolders, runFixture } from '@/e2e/fixtureRun'
import { RAVEN_CONTENT_TYPES } from '@/http'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { encodeClip, encodeImage, encodePicture } from '@/test/clips'
import { type FakeMovie, type FakeShow, fakeTmdb } from '@/test/fakeTmdb'

/**
 * The library the web's Lighthouse run scores Home against (`apps/raven/web/lighthouse`): a film
 * library and a series library, each with more titles than Home's shelf of eight shows, and a few
 * titles partway watched, so Home opens on its hero, Continue watching and a full shelf for each,
 * as it does on Vhagar. Every picture is a JPEG as heavy as TMDB's own at that size
 * (`encodePicture`), since the hero's backdrop and the posters are most of what Home loads. The
 * videos are copies of one short clip: Home reads their listing, never their bytes.
 */
const LIBRARIES = {
  films: 'Films',
  series: 'Series',
} as const

const FILM_TITLES = [
  'Kestrel Point',
  'The Salt Road',
  'Harbour Lights',
  'A Winter in Oran',
  'Glasswing',
  'The Long Field',
  'Northern Cross',
  'Paper Moons',
  'Ember Hill',
  'The Quiet Engine',
  'Saltmarsh',
  'Last Train to Brig',
] as const

const SHOW_TITLES = [
  'Lantern Bay',
  'The Orchard',
  'Fathom',
  'Copper Street',
  'High Meadow',
  'The Cartographers',
  'Stillwater',
  'Night Ferry',
  'Wren and Ash',
  'The Lighthouse Keepers',
] as const

const EPISODES_PER_SHOW = 3

/** How many films and episodes Home's Continue watching opens with. */
const IN_PROGRESS = { films: 3, episodes: 2 } as const

const CLIP_SECONDS = 60

/** Partway through `CLIP_SECONDS`, clear of the start and of the end a resume skips. */
const PROGRESS_SECONDS = 24

const FIRST_MOVIE_ID = 9100
const FIRST_SHOW_ID = 9200

/** The year every title came out in, a year apart, the newest first. */
const NEWEST_YEAR = 2025

/** TMDB's picture host, whose answers this fixture replaces with pictures of a real weight. */
const TMDB_IMAGE_HOST = 'image.tmdb.org'

/** A few palettes, so neighbouring posters on a shelf look apart. */
const PALETTES = [
  ['0x1d3557', '0xe63946', '0xf1faee'],
  ['0x264653', '0x2a9d8f', '0xe9c46a'],
  ['0x3d405b', '0xe07a5f', '0xf4f1de'],
  ['0x22223b', '0x9a8c98', '0xf2e9e4'],
] as const

type EncodeProps = { path: string; colours: (typeof PALETTES)[number] }

/**
 * Each picture raven asks TMDB for, at the size it asks for (`IMAGE_WIDTHS`), so each arrives as
 * heavy as TMDB's. Logos are flat, as TMDB's transparent PNG files nearly are.
 */
const PICTURES = {
  poster: {
    file: 'poster.jpg',
    type: RAVEN_CONTENT_TYPES.jpeg,
    encode: ({ path, colours }: EncodeProps) => encodePicture({ path, size: '500x750', colours }),
  },
  backdrop: {
    file: 'backdrop.jpg',
    type: RAVEN_CONTENT_TYPES.jpeg,
    encode: ({ path, colours }: EncodeProps) => encodePicture({ path, size: '1280x720', colours }),
  },
  logo: {
    file: 'logo.png',
    type: RAVEN_CONTENT_TYPES.png,
    encode: ({ path }: EncodeProps) => encodeImage({ path, size: '500x200' }),
  },
} as const

/** Each kind, which is also the word its TMDB file names carry (`fakeTmdb`): `/backdrop9100.jpg`. */
const PICTURE_KINDS = ['poster', 'backdrop', 'logo'] as const satisfies (keyof typeof PICTURES)[]

type PictureKind = (typeof PICTURE_KINDS)[number]

/** Which picture a TMDB file path names. */
const pictureKindOf = (path: string): PictureKind =>
  PICTURE_KINDS.find((kind) => basename(path).includes(kind)) ?? PICTURE_KINDS[0]

/** The palette a TMDB file path's id picks, so a title keeps its colours across its pictures. */
const paletteOf = (path: string): number =>
  Number(/\d+/.exec(basename(path))?.[0] ?? 0) % PALETTES.length

const yearOf = (index: number): number => NEWEST_YEAR - index

const movies: FakeMovie[] = FILM_TITLES.map((title, index) => ({
  id: FIRST_MOVIE_ID + index,
  title,
  released: `${yearOf(index)}-03-08`,
}))

const shows: FakeShow[] = SHOW_TITLES.map((title, index) => ({
  id: FIRST_SHOW_ID + index,
  title,
  first: `${yearOf(index)}-01-05`,
  seasons: {
    1: Array.from({ length: EPISODES_PER_SHOW }, (_, episode) => ({
      number: episode + 1,
      title: `Chapter ${episode + 1}`,
      aired: `${yearOf(index)}-01-${String(5 + episode * 7).padStart(2, '0')}`,
    })),
  },
}))

const tmdb = fakeTmdb({ movies, shows })

type PicturePathProps = { root: string; kind: PictureKind; palette: number }

const picturePathOf = ({ root, kind, palette }: PicturePathProps): string =>
  join(root, 'pictures', String(palette), PICTURES[kind].file)

/** Every picture TMDB is asked for, in each palette, encoded once before the server starts. */
const encodePictures = async (root: string): Promise<void> => {
  await Promise.all(
    PALETTES.flatMap((colours, palette) =>
      PICTURE_KINDS.map((kind) =>
        PICTURES[kind].encode({ path: picturePathOf({ root, kind, palette }), colours }),
      ),
    ),
  )
}

/** The fake TMDB, but with pictures of a real weight in place of its few placeholder bytes. */
const metadataFetchOver =
  (root: string): MetadataFetch =>
  async (request) => {
    const { hostname, pathname } = new URL(request.url)
    if (hostname !== TMDB_IMAGE_HOST) return tmdb.fetch(request)
    const kind = pictureKindOf(pathname)
    const bytes = await readFile(picturePathOf({ root, kind, palette: paletteOf(pathname) }))
    return new Response(bytes, { headers: { [HEADERS.contentType]: PICTURES[kind].type } })
  }

/** One clip, encoded once and copied to every film's and episode's file. */
const writeMedia = async ({ root, media }: FixtureFolders): Promise<void> => {
  const clip = join(root, 'clip.mp4')
  await encodeClip({ path: clip, seconds: CLIP_SECONDS })
  const films = movies.map(({ title, released }) => {
    const name = `${title} (${released.slice(0, 4)})`
    return join(media, 'films', name, `${name}.mp4`)
  })
  const episodes = shows.flatMap(({ title, seasons }) =>
    (seasons[1] ?? []).map(({ number, title: episode }) =>
      join(
        media,
        'series',
        title,
        'Season 1',
        `${title} - S01E${String(number).padStart(2, '0')} - ${episode}.mp4`,
      ),
    ),
  )
  await Promise.all(
    [...films, ...episodes].map(async (path) => {
      await mkdir(dirname(path), { recursive: true })
      await copyFile(clip, path)
    }),
  )
}

/** Plays a few films and episodes partway, so Home has a Continue watching row. */
const startWatching = async (api: ApiClient): Promise<void> => {
  const libraries = await api.listLibraries()
  const libraryIdOf = (name: string): number => {
    const library = libraries.find((candidate) => candidate.name === name)
    if (!library) throw new Error(`The Lighthouse fixture has no ${name} library`)
    return library.id
  }
  const [films, episodes] = await Promise.all([
    api.listMedia({ libraryId: libraryIdOf(LIBRARIES.films) }),
    api.listMedia({ libraryId: libraryIdOf(LIBRARIES.series) }),
  ])
  const started = [...films.slice(0, IN_PROGRESS.films), ...episodes.slice(0, IN_PROGRESS.episodes)]
  // One after another, so Continue watching orders them by when each was watched.
  await started.reduce<Promise<void>>(
    (previous, { id }) =>
      previous.then(() => api.saveProgress({ id, position: PROGRESS_SECONDS, audio: null })),
    Promise.resolve(),
  )
}

await runFixture({
  name: 'Lighthouse fixture',
  port: FIXTURE_SERVER.lighthousePort,
  webDir: null,
  metadataFetchFor: ({ root }) => metadataFetchOver(root),
  prepare: async (folders) => {
    await Promise.all([encodePictures(folders.root), writeMedia(folders)])
    return [
      {
        name: LIBRARIES.films,
        paths: [join(folders.media, 'films')],
        settings: { kind: LIBRARY_KINDS.movies },
      },
      {
        name: LIBRARIES.series,
        paths: [join(folders.media, 'series')],
        settings: { kind: LIBRARY_KINDS.shows },
      },
    ]
  },
  settle: startWatching,
})
