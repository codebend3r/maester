import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ApiClient, FIXTURE_SERVER, type LibraryInput } from '@raven/core'
import { createApp } from '@/app'
import { MetadataService } from '@/metadata/metadataService'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { apiFor } from '@/test/server'

const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const

/** The folders a fixture's `prepare` writes into, inside the run's own temporary folder. */
export type FixtureFolders = { root: string; media: string }

type RunFixtureProps = {
  /** Names the fixture in its ready line and its temporary folder: `fixture`, `Lighthouse fixture`. */
  name: string
  port: number
  /** The built web app's folder, which the server then serves beside its API; null for none. */
  webDir: string | null
  /** TMDB as this fixture's server sees it, which may read what `prepare` wrote. */
  metadataFetchFor: (folders: FixtureFolders) => MetadataFetch
  /** Writes the media under `folders.media` and answers the libraries to make over it. */
  prepare: (folders: FixtureFolders) => Promise<LibraryInput[]>
  /** What to do as the admin once every library is scanned and matched, before the ready line. */
  settle?: (api: ApiClient) => Promise<void>
}

/**
 * Starts a real, accountless raven server over a fixture's media and keeps it running until it is
 * stopped: it writes the media, makes the libraries, waits for their scans, matches and
 * thumbnails, runs `settle`, and only then listens and prints `raven <name> ready at <origin>`,
 * so a runner can wait for either. It listens on
 * the loopback, which the iOS and tvOS simulators share with the Mac. The temporary folder goes
 * however the run ends: a stop during the encodes, a failed start or a stop once serving.
 */
export const runFixture = async ({
  name,
  port,
  webDir,
  metadataFetchFor,
  prepare,
  settle = async () => undefined,
}: RunFixtureProps): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), `raven-${name.toLowerCase().replaceAll(' ', '-')}-`))
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
    const folders = { root, media: join(root, 'media') }
    const libraries = await prepare(folders)
    const app = await createApp({
      config: {
        ...testConfig({ dataDir: join(root, 'data'), mediaDir: folders.media, webDir }),
        host: FIXTURE_SERVER.host,
        port,
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
      metadataFetch: metadataFetchFor(folders),
    })
    hasShutdownHook = true
    await app.init()

    const api = apiFor({ app, cookie: await adminCookie(app) })
    const made = await Promise.all(libraries.map((library) => api.createLibrary(library)))
    await Promise.all(made.map((library) => app.get(ScannerService).whenIdle(library.id)))
    await app.get(MetadataService).whenIdle()
    await app.get(ThumbnailService).whenIdle()
    await settle(api)
    // Only now, so a runner polling `readyPath` never meets a library still scanning.
    await app.listen({ host: FIXTURE_SERVER.host, port })
    return `http://${FIXTURE_SERVER.host}:${port}`
  }

  // A failed start (an encode, the port taken, a library refused) leaves no folder behind.
  try {
    const address = await serve()
    console.log(`raven ${name} ready at ${address}`)
  } catch (error) {
    removeRoot()
    console.error(`raven ${name} could not start:`, error)
    process.exit(1)
  }
}
