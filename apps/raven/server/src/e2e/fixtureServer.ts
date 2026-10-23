import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { LIBRARY_KINDS } from '@raven/core'
import { createApp } from '@/app'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { ADMIN_PASSWORD, NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeRichClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
import { apiFor } from '@/test/server'

/**
 * A real raven server for the device app's Maestro flows (`apps/raven/app/e2e`): one locked
 * film library holding a movie and one open series library holding an episode, behind a PIN
 * and the admin password, with media tickets on. Both are matched against a fake TMDB, so no
 * request leaves the Mac. It listens on a fixed port on the loopback, which the iOS and tvOS
 * simulators share with the Mac, and lives until it is stopped.
 */
const FIXTURE = {
  host: '127.0.0.1',
  port: 8490,
  pin: '1357',
  movie: { library: 'Films', folder: 'Kestrel Point (2024)', file: 'Kestrel Point (2024).mkv' },
  show: {
    library: 'Series',
    folder: join('Lantern Bay', 'Season 1'),
    file: 'Lantern Bay - S01E01 - Low Tide.mkv',
  },
} as const

const tmdb = fakeTmdb({
  movies: [{ id: 9001, title: 'Kestrel Point', released: '2024-03-08' }],
  shows: [
    {
      id: 9002,
      title: 'Lantern Bay',
      first: '2024-01-05',
      seasons: { 1: [{ number: 1, title: 'Low Tide', aired: '2024-01-05' }] },
    },
  ],
})

const CUES = ['1', '00:00:02,000 --> 00:00:05,000', 'The tide is turning.', ''].join('\n')

const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const

const root = await mkdtemp(join(tmpdir(), 'raven-app-fixture-'))
const removeRoot = () => rmSync(root, { recursive: true, force: true, maxRetries: 5 })

// Until the server's own shutdown hook is registered, a stop ends the process here, so a
// signal during the encodes cannot leave it running; after that the hook ends it once the
// server has closed. Either way the folder goes first, synchronously.
let hasShutdownHook = false
STOP_SIGNALS.forEach((signal) =>
  process.once(signal, () => {
    removeRoot()
    if (!hasShutdownHook) process.exit(128 + constants.signals[signal])
  }),
)

const serve = async (): Promise<string> => {
  const media = join(root, 'media')
  const movies = join(media, 'movies')
  const shows = join(media, 'shows')
  await Promise.all([
    encodeRichClip({
      path: join(movies, FIXTURE.movie.folder, FIXTURE.movie.file),
      seconds: 60,
      cues: CUES,
    }),
    encodeRichClip({ path: join(shows, FIXTURE.show.folder, FIXTURE.show.file), cues: CUES }),
  ])

  const app = await createApp({
    config: {
      ...testConfig({ dataDir: join(root, 'data'), mediaDir: media }),
      host: FIXTURE.host,
      port: FIXTURE.port,
      libraryPin: FIXTURE.pin,
      tmdbApiToken: 'fixture-token',
      mediaPlane: {
        origins: [],
        webOrigins: [],
        secret: randomBytes(32),
        problems: [],
        secretProblems: [],
      },
    },
    watch: NOT_WATCHING,
    metadataFetch: tmdb.fetch,
  })
  hasShutdownHook = true
  await app.listen({ host: FIXTURE.host, port: FIXTURE.port })

  const api = apiFor({ app, cookie: await adminCookie(app) })
  const libraries = await Promise.all([
    api.createLibrary({
      name: FIXTURE.movie.library,
      paths: [movies],
      settings: { kind: LIBRARY_KINDS.movies, locked: true },
    }),
    api.createLibrary({
      name: FIXTURE.show.library,
      paths: [shows],
      settings: { kind: LIBRARY_KINDS.shows },
    }),
  ])
  await Promise.all(libraries.map((library) => app.get(ScannerService).whenIdle(library.id)))
  await app.get(MetadataService).whenIdle()
  await app.get(ThumbnailService).whenIdle()
  return `http://${FIXTURE.host}:${FIXTURE.port}`
}

// A failed start (an encode, the port taken, a library refused) leaves no folder behind.
try {
  const address = await serve()
  console.log(
    `raven fixture server ready at ${address} (PIN ${FIXTURE.pin}, admin password ${ADMIN_PASSWORD})`,
  )
} catch (error) {
  removeRoot()
  console.error('raven fixture server could not start:', error)
  process.exit(1)
}
