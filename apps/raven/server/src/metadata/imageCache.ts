import { mkdirSync } from 'node:fs'
import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { ItemImageKind } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { imageScaleArgs } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { METADATA_FETCH, type MetadataFetch, TMDB_IMAGE_PATH } from '@/metadata/tmdbClient'
import { type Gate, createGate } from '@/scanner/concurrency'

/** What a picture is for, which decides the one size it is kept at: an item's, or a person's photo. */
export type ImageUse = ItemImageKind | 'photo'

/** TMDB's size names, and the widths local images are scaled to so both look alike. */
const TMDB_SIZES: Record<ImageUse, string> = {
  poster: 'w500',
  backdrop: 'w1280',
  photo: 'w185',
  still: 'w300',
  logo: 'w500',
}

const WIDTHS: Record<ImageUse, number> = {
  poster: 500,
  backdrop: 1280,
  photo: 185,
  still: 300,
  logo: 500,
}

const TIMEOUT_MS = 10_000

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isFile() && info.size > 0,
    () => false,
  )

const temporary = (dir: string, extension: string): string =>
  join(dir, `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`)

export const contentTypeOf = (path: string): string =>
  path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'

/**
 * Posters, backdrops, photos and stills on disk beside the thumbnails.
 * TMDB's files sit under `images/tmdb/<size>/`, shared by every item and
 * person that uses them; pictures beside the media are scaled once with
 * ffmpeg into `images/local/<item>-<kind>-<mtime>.jpg`. Either is fetched or
 * made on first use, and two requests for the same one share the work.
 */
@Injectable()
export class ImageCache {
  private readonly logger = new Logger(ImageCache.name)
  private readonly root: string
  private readonly working = new Map<string, Promise<string | null>>()
  private readonly downloads: Gate = createGate({ limit: 4 })
  private readonly warned = new Set<string>()

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
  ) {
    this.root = join(config.dataDir, 'images')
    Object.values(TMDB_SIZES).forEach((size) =>
      mkdirSync(join(this.root, 'tmdb', size), { recursive: true }),
    )
    mkdirSync(join(this.root, 'local'), { recursive: true })
  }

  /** Runs `make` once per key at a time; later callers wait on the same promise. */
  private once(key: string, make: () => Promise<string | null>): Promise<string | null> {
    const running = this.working.get(key)
    if (running) return running
    const started = make().finally(() => this.working.delete(key))
    this.working.set(key, started)
    return started
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.logger.warn(message)
  }

  /** A TMDB picture's cached file, downloaded on first use; null when TMDB cannot serve it. */
  tmdb({ path, use }: { path: string; use: ImageUse }): Promise<string | null> {
    if (!TMDB_IMAGE_PATH.test(path)) return Promise.resolve(null)
    const size = TMDB_SIZES[use]
    const dir = join(this.root, 'tmdb', size)
    const target = join(dir, path.slice(1))
    return this.once(target, async () => {
      if (await exists(target)) return target
      return this.downloads.run(async () => {
        const response = await this.fetch(`https://image.tmdb.org/t/p/${size}${path}`, {
          headers: { accept: 'image/*' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }).catch(() => null)
        if (!response?.ok) {
          this.warnOnce(path, `TMDB could not serve ${size}${path}`)
          return null
        }
        const temp = temporary(dir, path.endsWith('.png') ? 'png' : 'jpg')
        try {
          await writeFile(temp, Buffer.from(await response.arrayBuffer()))
          await rename(temp, target)
          return target
        } catch (error) {
          await rm(temp, { force: true })
          this.warnOnce(path, `Could not cache ${path}: ${String(error)}`)
          return null
        }
      })
    })
  }

  /** A picture beside the media, scaled once; null when it is gone or will not decode. */
  local({
    itemId,
    kind,
    source,
    use,
  }: {
    itemId: number
    kind: string
    source: string
    use: ImageUse
  }): Promise<string | null> {
    return this.once(`${itemId}-${kind}`, async () => {
      const info = await stat(source).catch(() => null)
      if (!info?.isFile()) return null
      const dir = join(this.root, 'local')
      const prefix = `${itemId}-${kind}-`
      const target = join(dir, `${prefix}${Math.round(info.mtimeMs)}.jpg`)
      if (await exists(target)) return target
      const temp = temporary(dir, 'jpg')
      try {
        await this.ffmpeg.exec(imageScaleArgs({ input: source, output: temp, width: WIDTHS[use] }))
        if (!(await exists(temp))) throw new Error('ffmpeg wrote nothing')
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        this.warnOnce(source, `Could not read the image ${source}: ${String(error)}`)
        return null
      }
      // An older scale of a picture that has since changed.
      const names = await readdir(dir).catch((): string[] => [])
      await Promise.all(
        names
          .filter((name) => name.startsWith(prefix) && join(dir, name) !== target)
          .map((name) => rm(join(dir, name), { force: true })),
      )
      return target
    })
  }

  /**
   * Removes cached pictures nothing points at any more: TMDB files no item
   * or person uses, and local scales of items that are gone.
   */
  async sweep({
    tmdbPaths,
    itemIds,
  }: {
    tmdbPaths: ReadonlySet<string>
    itemIds: ReadonlySet<number>
  }): Promise<void> {
    await Promise.all(
      Object.values(TMDB_SIZES).map(async (size) => {
        const dir = join(this.root, 'tmdb', size)
        const names = await readdir(dir).catch((): string[] => [])
        await Promise.all(
          names
            .filter((name) => !name.startsWith('.') && !tmdbPaths.has(`/${name}`))
            .map((name) => rm(join(dir, name), { force: true })),
        )
      }),
    )
    const dir = join(this.root, 'local')
    const names = await readdir(dir).catch((): string[] => [])
    await Promise.all(
      names
        .filter((name) => !name.startsWith('.') && !itemIds.has(Number(name.split('-')[0])))
        .map((name) => rm(join(dir, name), { force: true })),
    )
  }
}
