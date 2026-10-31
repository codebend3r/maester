import { HEADERS } from '@shared/server'
import { mkdirSync } from 'node:fs'
import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  BACKDROP_OWN_WIDTH,
  type ItemImageKind,
  POSTER_OWN_WIDTH,
  POSTER_WIDTHS,
  type PosterWidth,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { temporary } from '@/fileNames'
import { imageScaleArgs } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { RAVEN_CONTENT_TYPES } from '@/http'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { TMDB_IMAGE_PATH } from '@/metadata/tmdbShapes'
import { createOnce } from '@/once'
import { type Gate, createGate } from '@/scanner/concurrency'

/** What a picture is for: an item's, or a person's photo. */
export type ImageUse = ItemImageKind | 'photo'

/**
 * The width each use is served at unless a narrower poster is asked for.
 * TMDB names its sizes by width (`w500`), and pictures beside the media are
 * scaled to the same widths, so both look alike.
 */
export const IMAGE_WIDTHS = {
  poster: POSTER_OWN_WIDTH,
  backdrop: BACKDROP_OWN_WIDTH,
  photo: 185,
  still: 300,
  logo: 500,
} as const satisfies Record<ImageUse, number>

/** Every width a picture is kept at: each use's own, and the narrower ones a poster comes in. */
export type ImageWidth = (typeof IMAGE_WIDTHS)[ImageUse] | PosterWidth

const KEPT_WIDTHS: readonly ImageWidth[] = [
  ...new Set<ImageWidth>([...Object.values(IMAGE_WIDTHS), ...POSTER_WIDTHS]),
]

const TIMEOUT_MS = 10_000

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isFile() && info.size > 0,
    () => false,
  )

export const contentTypeOf = (path: string): string =>
  path.toLowerCase().endsWith('.png') ? RAVEN_CONTENT_TYPES.png : RAVEN_CONTENT_TYPES.jpeg

type ImageCacheWarnOnceProps = { key: string; message: string }

type ImageCacheTmdbProps = { path: string; width: ImageWidth }

type ImageCacheDownloadedProps = {
  /** Where the picture is kept; its folder exists. */
  target: string
  url: string
  /** What the picture is, for the warning when it cannot be had. */
  what: string
}

type ImageCacheLocalProps = {
  itemId: number
  kind: string
  source: string
  width: ImageWidth
}

type ImageCacheAlbumProps = {
  albumId: number
  /** The file the cover is read from: the one that embeds it, or the picture itself. */
  source: string
  width: ImageWidth
}

type ImageCacheScaledProps = {
  dir: (typeof SCALED_DIRS)[keyof typeof SCALED_DIRS]
  /** What names the picture's owner in the file name, up to the mtime: `<item>-<kind>-`, `<album>-`. */
  prefix: string
  source: string
  width: ImageWidth
}

type ImageCacheSweepProps = {
  tmdbPaths: ReadonlySet<string>
  itemIds: ReadonlySet<number>
  albumIds: ReadonlySet<number>
  /** The release ids whose archive covers albums still show. */
  coverArtIds: ReadonlySet<string>
}

/** The folders under `images/` that hold pictures scaled from files beside or inside the media. */
const SCALED_DIRS = { local: 'local', albums: 'albums' } as const

/** The item or album a scale belongs to: what its file name starts with, before the mtime. */
const ownerOf = (file: string): number => Number(file.split('-')[0])

/** The folder under `images/` that holds the Cover Art Archive's covers as fetched, named by release id. */
const COVER_ART_DIR = 'cover-art'

/**
 * Posters, backdrops, photos and stills on disk beside the thumbnails, each
 * at the widths it is asked for. TMDB's files sit under
 * `images/tmdb/w<width>/`, shared by every item and person that uses them;
 * pictures beside the media are scaled once per width with ffmpeg into
 * `images/local/<item>-<kind>-<mtime>-<width>.jpg`. Either is fetched or
 * made on first use, and two requests for the same one share the work.
 */
@Injectable()
export class ImageCache {
  private readonly logger = new Logger(ImageCache.name)
  private readonly root: string
  private readonly working = createOnce<string | null>()
  private readonly downloads: Gate = createGate({ limit: 4 })
  // Scaling takes CPU the server shares with transcodes, and matching a
  // library of pictures beside its media asks for three widths of each.
  private readonly scales: Gate = createGate({ limit: 2 })
  private readonly warned = new Set<string>()

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
  ) {
    this.root = join(config.dataDir, 'images')
    KEPT_WIDTHS.forEach((width) =>
      mkdirSync(join(this.root, 'tmdb', `w${width}`), { recursive: true }),
    )
    const scaled: readonly string[] = [...Object.values(SCALED_DIRS), COVER_ART_DIR]
    scaled.forEach((dir) => mkdirSync(join(this.root, dir), { recursive: true }))
  }

  /** Poster warming outlives a match, so shutdown must wait for its queued writes too. */
  async onModuleDestroy(): Promise<void> {
    await this.working.settled()
  }

  private warnOnce({ key, message }: ImageCacheWarnOnceProps): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.logger.warn(message)
  }

  /** A TMDB picture's cached file at `width`, downloaded on first use; null when TMDB cannot serve it. */
  tmdb({ path, width }: ImageCacheTmdbProps): Promise<string | null> {
    if (!TMDB_IMAGE_PATH.test(path)) return Promise.resolve(null)
    const size = `w${width}`
    return this.downloaded({
      target: join(this.root, 'tmdb', size, path.slice(1)),
      url: `https://image.tmdb.org/t/p/${size}${path}`,
      what: `${size}${path}`,
    })
  }

  /**
   * The Cover Art Archive's front cover of a release, at its 500 pixel
   * size, downloaded on first use; null when the archive has none. The
   * album's narrower covers are scaled from it.
   */
  coverArt(mbid: string): Promise<string | null> {
    return this.downloaded({
      target: join(this.root, COVER_ART_DIR, `${mbid}.jpg`),
      url: `https://coverartarchive.org/release/${encodeURIComponent(mbid)}/front-500`,
      what: `the cover of release ${mbid}`,
    })
  }

  /** A picture fetched from `url` into `target` once; null when it cannot be had, warned of once. */
  private downloaded({ target, url, what }: ImageCacheDownloadedProps): Promise<string | null> {
    return this.working.run({
      key: target,
      make: async () => {
        if (await exists(target)) return target
        return this.downloads.run(async () => {
          const response = await this.fetch({
            url,
            init: {
              headers: { [HEADERS.accept]: RAVEN_CONTENT_TYPES.anyImage },
              signal: AbortSignal.timeout(TIMEOUT_MS),
            },
          }).catch(() => null)
          if (!response?.ok) {
            this.warnOnce({ key: url, message: `Could not fetch ${what}` })
            return null
          }
          const dir = dirname(target)
          const temp = temporary({ dir, extension: target.endsWith('.png') ? 'png' : 'jpg' })
          try {
            await writeFile(temp, Buffer.from(await response.arrayBuffer()))
            await rename(temp, target)
            return target
          } catch (error) {
            await rm(temp, { force: true })
            this.warnOnce({ key: url, message: `Could not cache ${what}: ${String(error)}` })
            return null
          }
        })
      },
    })
  }

  /** A picture beside the media, scaled once to `width`; null when it is gone or will not decode. */
  local({ itemId, kind, source, width }: ImageCacheLocalProps): Promise<string | null> {
    return this.scaled({ dir: SCALED_DIRS.local, prefix: `${itemId}-${kind}-`, source, width })
  }

  /**
   * An album's cover, scaled once to `width` from the file that holds it:
   * the picture in its folder, or a track that embeds one, whose attached
   * picture is the one frame ffmpeg reads off it. Null when the file is
   * gone or will not decode.
   */
  album({ albumId, source, width }: ImageCacheAlbumProps): Promise<string | null> {
    return this.scaled({ dir: SCALED_DIRS.albums, prefix: `${albumId}-`, source, width })
  }

  /**
   * A picture scaled from `source` into `dir` as `<prefix><mtime>-<width>.jpg`,
   * made once; scales of the file before it changed go when a new one is made.
   */
  private scaled({
    dir: name,
    prefix,
    source,
    width,
  }: ImageCacheScaledProps): Promise<string | null> {
    return this.working.run({
      key: `${name}/${prefix}${width}`,
      make: async () => {
        const info = await stat(source).catch(() => null)
        if (!info?.isFile()) return null
        const dir = join(this.root, name)
        const current = `${prefix}${Math.round(info.mtimeMs)}-`
        const target = join(dir, `${current}${width}.jpg`)
        if (await exists(target)) return target
        const temp = temporary({ dir, extension: 'jpg' })
        try {
          await this.scales.run(() =>
            this.ffmpeg.exec({ args: imageScaleArgs({ input: source, output: temp, width }) }),
          )
          if (!(await exists(temp))) throw new Error('ffmpeg wrote nothing')
          await rename(temp, target)
        } catch (error) {
          await rm(temp, { force: true })
          this.warnOnce({
            key: source,
            message: `Could not read the image ${source}: ${String(error)}`,
          })
          return null
        }
        // Scales of the picture before it changed, at any width, and any named before widths were.
        const files = await readdir(dir).catch((): string[] => [])
        await Promise.all(
          files
            .filter((file) => file.startsWith(prefix) && !file.startsWith(current))
            .map((file) => rm(join(dir, file), { force: true })),
        )
        return target
      },
    })
  }

  /**
   * Removes cached pictures nothing points at any more: TMDB files no item
   * or person uses, and scales of items and albums that are gone.
   */
  async sweep({ tmdbPaths, itemIds, albumIds, coverArtIds }: ImageCacheSweepProps): Promise<void> {
    await Promise.all(
      KEPT_WIDTHS.map(async (width) => {
        const dir = join(this.root, 'tmdb', `w${width}`)
        const names = await readdir(dir).catch((): string[] => [])
        await Promise.all(
          names
            .filter((name) => !name.startsWith('.') && !tmdbPaths.has(`/${name}`))
            .map((name) => rm(join(dir, name), { force: true })),
        )
      }),
    )
    await Promise.all(
      [
        { dir: SCALED_DIRS.local, isKept: (file: string) => itemIds.has(ownerOf(file)) },
        { dir: SCALED_DIRS.albums, isKept: (file: string) => albumIds.has(ownerOf(file)) },
        {
          dir: COVER_ART_DIR,
          isKept: (file: string) => coverArtIds.has(file.replace(/\.jpg$/, '')),
        },
      ].map(async ({ dir: name, isKept }) => {
        const dir = join(this.root, name)
        const names = await readdir(dir).catch((): string[] => [])
        await Promise.all(
          names
            .filter((file) => !file.startsWith('.') && !isKept(file))
            .map((file) => rm(join(dir, file), { force: true })),
        )
      }),
    )
  }
}
