import { dirname, join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import {
  type LibraryKind,
  type MatchState,
  type MetadataHealth,
  type NameIds,
  foldTitle,
  isExtra,
  parseMovieName,
} from '@raven/core'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaRepository, type PendingFile } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import { listFolder, movieAssets } from '@/metadata/localAssets'
import { pickMatch } from '@/metadata/matcher'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { readNfoIds } from '@/metadata/nfo'
import { TmdbClient, TmdbError } from '@/metadata/tmdbClient'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

/** The library types whose files get matched. */
export const MATCHED_KINDS: readonly LibraryKind[] = ['movies']

const DAY_MS = 24 * 60 * 60 * 1000

/** How many files of a pass are worked on at once; TMDB's own limit spaces the calls. */
const PASS_CONCURRENCY = 4

const stemOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** A file's own place: its path inside the library, the key a Fix match is kept under when its folder holds more. */
const filePlace = (file: { folder: string; fileName: string }): string =>
  file.folder === '' ? file.fileName : join(file.folder, file.fileName)

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Whether a TMDB failure means the rest of a pass should wait for the next one. */
const stopsThePass = (error: unknown): boolean =>
  error instanceof TmdbError && (error.kind === 'unavailable' || error.kind === 'unauthorized')

/** What one pass remembers, so a folder is read and a title searched once. */
type PassContext = {
  folders: Map<string, Promise<string[]>>
  ownFolders: Map<string, boolean>
  searches: Map<string, Promise<string | null>>
  fetches: Map<string, Promise<number | null>>
  nfos: Map<string, Promise<NameIds | null>>
  stopped: { error: unknown }
}

const newContext = (): PassContext => ({
  folders: new Map(),
  ownFolders: new Map(),
  searches: new Map(),
  fetches: new Map(),
  nfos: new Map(),
  stopped: { error: null },
})

/** `make()` once per key in a pass; later callers share the promise. */
const remember = <T>({
  cache,
  key,
  make,
}: {
  cache: Map<string, Promise<T>>
  key: string
  make: () => Promise<T>
}): Promise<T> => {
  const known = cache.get(key)
  if (known) return known
  const made = make()
  cache.set(key, made)
  return made
}

/**
 * Matches the files in Movies libraries to TMDB, one library pass at a
 * time, in the background. A Fix match wins, then an id in a name or NFO,
 * then a search by title and year that only takes a sure answer. Items are
 * shared, so a second file of the same movie costs a search and no fetch.
 * A daily sweep refreshes what has gone stale, and every pass ends by
 * removing items, people and pictures nothing uses any more.
 */
@Injectable()
export class MetadataService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetadataService.name)
  private readonly queue = createTaskQueue({ concurrency: 1 })
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  /**
   * Names indexed before they were parsed are read again, every Movies
   * library gets a pass for what is pending, and the sweep starts.
   */
  onApplicationBootstrap(): void {
    this.libraries
      .list()
      .filter((library) => MATCHED_KINDS.includes(library.settings.kind))
      .forEach((library) => {
        this.media.retitle({ libraryId: library.id, kind: library.settings.kind })
        this.enqueue(library.id)
      })
    if (!this.tmdb.enabled) return
    this.queue.push('sweep', () => this.sweep())
    this.timer = setInterval(() => this.queue.push('sweep', () => this.sweep()), DAY_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Queues a pass over the library: its pending files, then the clear-up. */
  enqueue(libraryId: number): void {
    this.queue.push(`library:${libraryId}`, () => this.pass(libraryId))
  }

  /**
   * A library's type changed: every file's name is read again for the new
   * type and matched from scratch, or left off for Other.
   */
  changeKind({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    this.queue.push(`kind:${libraryId}:${kind}`, async () => {
      this.media.rename({ libraryId, kind })
      await this.pass(libraryId)
    })
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  health(): MetadataHealth {
    const tmdb = this.tmdb.state()
    return {
      tmdb: tmdb.state,
      omdb: 'off',
      pending: this.media.countPending(MATCHED_KINDS),
      error: tmdb.error,
      lastOk: tmdb.lastOk,
    }
  }

  private async pass(libraryId: number): Promise<void> {
    const library = this.libraries.get(libraryId)
    if (library && library.settings.kind === 'movies' && this.tmdb.enabled) {
      this.tmdb.newPass()
      await this.matchPending(libraryId)
    }
    await this.clearUp()
  }

  /** Matches the library's pending files, and any that turn up while it runs. */
  private async matchPending(libraryId: number): Promise<void> {
    const context = newContext()
    const attempted = new Set<number>()
    const round = async (): Promise<void> => {
      const files = this.media.pending(libraryId).filter((file) => !attempted.has(file.id))
      if (files.length === 0 || context.stopped.error != null) return
      files.forEach((file) => attempted.add(file.id))
      await mapWithConcurrency({
        items: files,
        limit: PASS_CONCURRENCY,
        fn: (file) => this.matchFile({ file, context }),
      })
      return round()
    }
    await round()
    if (context.stopped.error != null) {
      this.logger.warn(`Matching stopped for now: ${message(context.stopped.error)}`)
    }
  }

  /** A file's own failure leaves it pending for the next pass; TMDB going away stops this one. */
  private async matchFile({
    file,
    context,
  }: {
    file: PendingFile
    context: PassContext
  }): Promise<void> {
    if (context.stopped.error != null) return
    try {
      await this.matchMovie({ file, context })
    } catch (error) {
      if (stopsThePass(error)) {
        context.stopped.error = error
        return
      }
      this.logger.warn(`Could not match ${file.path}: ${message(error)}`)
    }
  }

  /** The file names in a folder, read once a pass. */
  private names({ dir, context }: { dir: string; context: PassContext }): Promise<string[]> {
    return remember({ cache: context.folders, key: dir, make: () => listFolder(dir) })
  }

  /**
   * Whether a folder holds one movie, perhaps in several qualities: its own
   * pictures, NFO and Fix match then belong to that movie. A library's root
   * never does.
   */
  private ownFolder({
    libraryId,
    folder,
    context,
  }: {
    libraryId: number
    folder: string
    context: PassContext
  }): boolean {
    if (folder === '') return false
    const key = `${libraryId}:${folder}`
    const known = context.ownFolders.get(key)
    if (known != null) return known
    const movies = new Set(
      this.media
        .inFolder({ libraryId, folder })
        .filter((file) => !isExtra(file))
        .map((file) => {
          const parsed = parseMovieName(file)
          return `${foldTitle(parsed.title)}|${parsed.year ?? ''}`
        }),
    )
    const own = movies.size === 1
    context.ownFolders.set(key, own)
    return own
  }

  /** The Fix match for a file: its own place first, then its folder's. */
  private overrideFor({
    file,
    own,
  }: {
    file: PendingFile
    own: boolean
  }): string | null | undefined {
    const forFile = this.metadata.override({ libraryId: file.libraryId, place: filePlace(file) })
    if (forFile !== undefined || !own) return forFile
    return this.metadata.override({ libraryId: file.libraryId, place: file.folder })
  }

  /** TMDB's id for the first id a name or NFO gives, or null. */
  private async idFromIds(ids: NameIds): Promise<string | null> {
    if (ids.tmdb != null) return ids.tmdb
    if (ids.imdb != null) {
      return (await this.tmdb.find({ id: ids.imdb, source: 'imdb_id' })).movies[0] ?? null
    }
    if (ids.tvdb != null) {
      return (await this.tmdb.find({ id: ids.tvdb, source: 'tvdb_id' })).movies[0] ?? null
    }
    return null
  }

  private async searchMovie({
    title,
    year,
    context,
  }: {
    title: string
    year: number | null
    context: PassContext
  }): Promise<string | null> {
    return remember({
      cache: context.searches,
      key: `${foldTitle(title)}|${year ?? ''}`,
      make: async () => {
        const results = await this.tmdb.searchMovies({ query: title, year })
        return pickMatch({ title, year, results })?.tmdbId ?? null
      },
    })
  }

  /** The stored movie for a TMDB id, fetched first when raven does not have it; null when TMDB has no such movie. */
  private ensureMovie({
    tmdbId,
    context,
  }: {
    tmdbId: string
    context: PassContext
  }): Promise<number | null> {
    return remember({
      cache: context.fetches,
      key: tmdbId,
      make: async () => {
        const stored = this.metadata.find({ type: 'movie', tmdbId })
        if (stored) return stored.id
        try {
          return this.metadata.save({ item: await this.tmdb.movie(tmdbId) })
        } catch (error) {
          if (error instanceof TmdbError && error.kind === 'not-found') return null
          throw error
        }
      },
    })
  }

  private async matchMovie({
    file,
    context,
  }: {
    file: PendingFile
    context: PassContext
  }): Promise<void> {
    if (isExtra(file)) {
      this.media.setMatch({ ids: [file.id], match: 'off' })
      return
    }
    const dir = dirname(file.path)
    const own = this.ownFolder({ libraryId: file.libraryId, folder: file.folder, context })
    const assets = movieAssets({
      names: await this.names({ dir, context }),
      stem: stemOf(file.fileName),
      ownFolder: own,
    })
    const override = this.overrideFor({ file, own })
    if (override === null) {
      this.settle({ mediaIds: [file.id], itemId: null, match: 'unmatched' })
      return
    }

    const parsed = parseMovieName(file)
    const fromNames = async (): Promise<string | null> => {
      const fromName = await this.idFromIds(parsed.ids)
      if (fromName != null || assets.nfo == null) return fromName
      const nfoPath = join(dir, assets.nfo)
      const nfoIds = await remember({
        cache: context.nfos,
        key: nfoPath,
        make: () => readNfoIds(nfoPath),
      })
      return nfoIds ? this.idFromIds(nfoIds) : null
    }
    const tmdbId =
      override ??
      (await fromNames()) ??
      (await this.searchMovie({ title: file.title, year: file.year, context }))
    const itemId = tmdbId == null ? null : await this.ensureMovie({ tmdbId, context })
    if (itemId == null) {
      this.settle({ mediaIds: [file.id], itemId: null, match: 'unmatched' })
      return
    }
    this.metadata.setLocalImages({
      itemId,
      images: {
        ...(assets.poster ? { poster: join(dir, assets.poster) } : {}),
        ...(assets.backdrop ? { backdrop: join(dir, assets.backdrop) } : {}),
      },
    })
    this.settle({ mediaIds: [file.id], itemId, match: override != null ? 'manual' : 'matched' })
    this.warmPoster(itemId)
  }

  /** Links files to their item, or to none, and records how matching went. */
  private settle({
    mediaIds,
    itemId,
    match,
  }: {
    mediaIds: readonly number[]
    itemId: number | null
    match: MatchState
  }): void {
    if (itemId == null) this.metadata.unlink(mediaIds)
    else this.metadata.link({ mediaIds, itemIds: [itemId] })
    this.media.setMatch({ ids: mediaIds, match })
  }

  /** Posters are fetched as soon as an item is matched, so a library's first visit is quick. */
  private warmPoster(itemId: number): void {
    const image = this.metadata.image({ itemId, kind: 'poster' })
    if (!image) return
    const made =
      image.source === 'local'
        ? this.images.local({ itemId, kind: 'poster', source: image.ref, use: 'poster' })
        : this.images.tmdb({ path: image.ref, use: 'poster' })
    void made.catch(() => null)
  }

  /**
   * Fix match: points a file, and its folder's other files when the folder
   * holds one movie, at a TMDB id, or at nothing for `null`, and keeps that
   * by place so renames and re-downloads keep it.
   */
  async fixMatch({ mediaId, tmdbId }: { mediaId: number; tmdbId: string | null }): Promise<void> {
    const record = this.media.get(mediaId)
    if (!record) return
    const context = newContext()
    const own = this.ownFolder({ libraryId: record.libraryId, folder: record.folder, context })
    this.metadata.saveOverride({
      libraryId: record.libraryId,
      place: own ? record.folder : filePlace(record),
      tmdbId,
    })
    const files: PendingFile[] = own
      ? this.media
          .inFolder({ libraryId: record.libraryId, folder: record.folder })
          .filter((file) => !isExtra(file))
      : [record]
    this.metadata.unlink(files.map((file) => file.id))
    this.media.setMatch({ ids: files.map((file) => file.id), match: 'pending' })
    await files.reduce(
      (previous, file) => previous.then(() => this.matchMovie({ file, context })),
      Promise.resolve(),
    )
    await this.clearUp()
  }

  /**
   * Fetches an item again now, and reads the pictures beside its files
   * again. One TMDB no longer has goes, and its files go back to pending, or
   * to unmatched when a Fix match pointed there. False when it went.
   */
  async refresh(itemId: number): Promise<boolean> {
    const item = this.metadata.get(itemId)
    if (!item || item.type !== 'movie') return false
    try {
      this.metadata.save({ item: await this.tmdb.movie(item.tmdbId) })
    } catch (error) {
      if (!(error instanceof TmdbError && error.kind === 'not-found')) throw error
      this.forget(itemId)
      return false
    }
    const files = this.media.forItem(itemId)
    const context = newContext()
    const found = await Promise.all(
      files.map(async (file) => {
        const dir = dirname(file.path)
        return {
          dir,
          assets: movieAssets({
            names: await this.names({ dir, context }),
            stem: stemOf(file.fileName),
            ownFolder: this.ownFolder({ libraryId: file.libraryId, folder: file.folder, context }),
          }),
        }
      }),
    )
    const poster = found.find((entry) => entry.assets.poster != null)
    const backdrop = found.find((entry) => entry.assets.backdrop != null)
    this.metadata.setLocalImages({
      itemId,
      images: {
        ...(poster?.assets.poster ? { poster: join(poster.dir, poster.assets.poster) } : {}),
        ...(backdrop?.assets.backdrop
          ? { backdrop: join(backdrop.dir, backdrop.assets.backdrop) }
          : {}),
      },
    })
    this.warmPoster(itemId)
    return true
  }

  private forget(itemId: number): void {
    const files = this.metadata.mediaFor(itemId).flatMap((id) => this.media.get(id) ?? [])
    this.metadata.remove(itemId)
    const manual = files.filter((file) => file.match === 'manual').map((file) => file.id)
    const automatic = files.filter((file) => file.match !== 'manual').map((file) => file.id)
    this.media.setMatch({ ids: manual, match: 'unmatched' })
    this.media.setMatch({ ids: automatic, match: 'pending' })
    files.forEach((file) => this.enqueue(file.libraryId))
  }

  /**
   * Refreshes movies fetched more than 30 days ago, or more than 7 days ago
   * when they came out in the last 90 days, while their details still move.
   */
  async sweep(): Promise<void> {
    if (!this.tmdb.enabled) return
    const now = Date.now()
    const stale = this.metadata.stale({
      type: 'movie',
      before: new Date(now - 30 * DAY_MS).toISOString(),
      recentBefore: new Date(now - 7 * DAY_MS).toISOString(),
      releasedAfter: new Date(now - 90 * DAY_MS).toISOString().slice(0, 10),
    })
    const stopped: { error: unknown } = { error: null }
    await mapWithConcurrency({
      items: stale,
      limit: PASS_CONCURRENCY,
      fn: async ({ id }) => {
        if (stopped.error != null) return
        await this.refresh(id).catch((error: unknown) => {
          if (stopsThePass(error)) stopped.error = error
        })
      },
    })
    await this.clearUp()
  }

  private async clearUp(): Promise<void> {
    await this.images.sweep(this.metadata.clearUp())
  }
}
