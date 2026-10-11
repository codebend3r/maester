import { basename, dirname, join } from 'node:path'
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
  parseEpisodeName,
  parseMovieName,
  seasonFolderNumber,
} from '@raven/core'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaRepository, type PendingFile } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import {
  episodeStill,
  listFolder,
  movieAssets,
  seasonPoster,
  showAssets,
} from '@/metadata/localAssets'
import { pickMatch } from '@/metadata/matcher'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { readNfoIds } from '@/metadata/nfo'
import { OmdbClient } from '@/metadata/omdbClient'
import { type FetchedItem, TmdbClient, TmdbError } from '@/metadata/tmdbClient'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

/** The library types whose files get matched. */
export const MATCHED_KINDS: readonly LibraryKind[] = ['movies', 'shows']

const DAY_MS = 24 * 60 * 60 * 1000

/** How many files, or shows, of a pass are worked on at once; TMDB's own limit spaces the calls. */
const PASS_CONCURRENCY = 4

/** Items raven made up for episodes and seasons TMDB does not list; never fetched. */
const LOCAL = 'local:'

const stemOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** A file's own place: its path inside the library, the key a Fix match is kept under when its folder holds more. */
const filePlace = (file: { folder: string; fileName: string }): string =>
  file.folder === '' ? file.fileName : join(file.folder, file.fileName)

/** The library path a file was found under, which its path starts with. */
const rootOf = (file: { path: string; folder: string; fileName: string }): string =>
  file.path.slice(0, file.path.length - filePlace(file).length - 1)

/** The first segment of a file's folder when it names a show, so a Fix match covers every season under it. */
const showFolderOf = (file: { folder: string }): string | null => {
  const first = file.folder.split(/[\\/]/).find((segment) => segment !== '') ?? ''
  return first !== '' && seasonFolderNumber(first) == null ? first : null
}

/** Where a show's files are kept together: the show's folder, or the file itself at a root. */
const showPlace = (file: PendingFile): string => showFolderOf(file) ?? filePlace(file)

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Whether a TMDB failure means the rest of a pass should wait for the next one. */
const stopsThePass = (error: unknown): boolean =>
  error instanceof TmdbError && (error.kind === 'unavailable' || error.kind === 'unauthorized')

const notFound = (error: unknown): boolean =>
  error instanceof TmdbError && error.kind === 'not-found'

const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> =>
  items.reduce((groups, item) => {
    const k = key(item)
    return groups.set(k, [...(groups.get(k) ?? []), item])
  }, new Map<string, T[]>())

const blank = (item: Pick<FetchedItem, 'type' | 'tmdbId' | 'number' | 'title'>): FetchedItem => ({
  ...item,
  originalTitle: null,
  year: null,
  released: null,
  ended: null,
  summary: null,
  tagline: null,
  contentRating: null,
  runtime: null,
  studio: null,
  genres: [],
  imdbId: null,
  tvdbId: null,
  images: { poster: null, backdrop: null, still: null },
  credits: [],
  rating: null,
  reviews: [],
})

/** A season TMDB does not list, so its files still have somewhere to sit. */
const localSeason = ({ showTmdbId, number }: { showTmdbId: string; number: number }): FetchedItem =>
  blank({
    type: 'season',
    tmdbId: `${LOCAL}${showTmdbId}:S${number}`,
    number,
    title: number === 0 ? 'Specials' : `Season ${number}`,
  })

/** An episode TMDB does not list (another order, or absolute numbering), with its parsed name. */
const localEpisode = ({
  showTmdbId,
  season,
  number,
  title,
}: {
  showTmdbId: string
  season: number
  number: number
  title: string | null
}): FetchedItem =>
  blank({
    type: 'episode',
    tmdbId: `${LOCAL}${showTmdbId}:S${season}E${number}`,
    number,
    title: title ?? `Episode ${number}`,
  })

/** A stored season, its number, and its episodes by number. */
type SeasonData = { id: number; number: number; local: boolean; episodes: Map<number, number> }

/** What one pass remembers, so a folder is read, a title searched and a season fetched once. */
type PassContext = {
  folders: Map<string, Promise<string[]>>
  ownFolders: Map<string, boolean>
  searches: Map<string, Promise<string | null>>
  fetches: Map<string, Promise<number | null>>
  seasons: Map<string, Promise<SeasonData>>
  refetched: Set<string>
  nfos: Map<string, Promise<NameIds | null>>
  stopped: { error: unknown }
}

const newContext = (): PassContext => ({
  folders: new Map(),
  ownFolders: new Map(),
  searches: new Map(),
  fetches: new Map(),
  seasons: new Map(),
  refetched: new Set(),
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
 * Matches the files in Movies and TV shows libraries to TMDB, one library
 * pass at a time, in the background. A Fix match wins, then an id in a name
 * or NFO, then a search by title and year that only takes a sure answer.
 * Items are shared, so a second file of the same movie costs a search and
 * no fetch; a show is matched once per show folder, and each season fetched
 * once. A daily sweep refreshes what has gone stale, and every pass ends by
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
    @Inject(OmdbClient) private readonly omdb: OmdbClient,
  ) {}

  /**
   * Names indexed before they were parsed are read again, every matched
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
      omdb: this.omdb.state().state,
      pending: this.media.countPending(MATCHED_KINDS),
      error: tmdb.error,
      lastOk: tmdb.lastOk,
    }
  }

  private async pass(libraryId: number): Promise<void> {
    const library = this.libraries.get(libraryId)
    if (library && MATCHED_KINDS.includes(library.settings.kind) && this.tmdb.enabled) {
      this.tmdb.newPass()
      await this.matchPending({ libraryId, kind: library.settings.kind })
    }
    await this.clearUp()
  }

  /** Matches the library's pending files, and any that turn up while it runs. */
  private async matchPending({
    libraryId,
    kind,
  }: {
    libraryId: number
    kind: LibraryKind
  }): Promise<void> {
    const context = newContext()
    const attempted = new Set<number>()
    const round = async (): Promise<void> => {
      const files = this.media.pending(libraryId).filter((file) => !attempted.has(file.id))
      if (files.length === 0 || context.stopped.error != null) return
      files.forEach((file) => attempted.add(file.id))
      if (kind === 'shows') {
        await mapWithConcurrency({
          items: [...groupBy(files, showPlace).values()],
          limit: PASS_CONCURRENCY,
          fn: (group) =>
            this.guarded({ context, run: () => this.matchShowGroup({ files: group, context }) }),
        })
      } else {
        await mapWithConcurrency({
          items: files,
          limit: PASS_CONCURRENCY,
          fn: (file) => this.guarded({ context, run: () => this.matchMovie({ file, context }) }),
        })
      }
      return round()
    }
    await round()
    if (context.stopped.error != null) {
      this.logger.warn(`Matching stopped for now: ${message(context.stopped.error)}`)
    }
  }

  /** A file's own failure leaves it pending for the next pass; TMDB going away stops this one. */
  private async guarded({
    context,
    run,
  }: {
    context: PassContext
    run: () => Promise<void>
  }): Promise<void> {
    if (context.stopped.error != null) return
    try {
      await run()
    } catch (error) {
      if (stopsThePass(error)) {
        context.stopped.error = error
        return
      }
      this.logger.warn(`Could not match: ${message(error)}`)
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

  /** The Fix match for a movie file: its own place first, then its folder's. */
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

  /** TMDB's id for the first id a name or NFO gives, as a movie or a show. */
  private async idFromIds({
    ids,
    type,
  }: {
    ids: NameIds
    type: 'movie' | 'show'
  }): Promise<string | null> {
    if (ids.tmdb != null) return ids.tmdb
    const pick = (found: { movies: string[]; shows: string[] }): string | null =>
      (type === 'movie' ? found.movies[0] : found.shows[0]) ?? null
    if (type === 'show' && ids.tvdb != null) {
      return pick(await this.tmdb.find({ id: ids.tvdb, source: 'tvdb_id' }))
    }
    if (ids.imdb != null) return pick(await this.tmdb.find({ id: ids.imdb, source: 'imdb_id' }))
    if (ids.tvdb != null) return pick(await this.tmdb.find({ id: ids.tvdb, source: 'tvdb_id' }))
    return null
  }

  /** The ids in an NFO, read once a pass. */
  private nfoIds({
    path,
    context,
  }: {
    path: string
    context: PassContext
  }): Promise<NameIds | null> {
    return remember({ cache: context.nfos, key: path, make: () => readNfoIds(path) })
  }

  private search({
    type,
    title,
    year,
    context,
  }: {
    type: 'movie' | 'show'
    title: string
    year: number | null
    context: PassContext
  }): Promise<string | null> {
    return remember({
      cache: context.searches,
      key: `${type}|${foldTitle(title)}|${year ?? ''}`,
      make: async () => {
        const results =
          type === 'movie'
            ? await this.tmdb.searchMovies({ query: title, year })
            : await this.tmdb.searchShows({ query: title, year })
        return pickMatch({ title, year, results })?.tmdbId ?? null
      },
    })
  }

  /** The stored movie or show for a TMDB id, fetched first when raven does not have it; null when TMDB has no such one. */
  private ensure({
    type,
    tmdbId,
    context,
  }: {
    type: 'movie' | 'show'
    tmdbId: string
    context: PassContext
  }): Promise<number | null> {
    return remember({
      cache: context.fetches,
      key: `${type}:${tmdbId}`,
      make: async () => {
        const stored = this.metadata.find({ type, tmdbId })
        if (stored) return stored.id
        try {
          const item =
            type === 'movie' ? await this.tmdb.movie(tmdbId) : await this.tmdb.show(tmdbId)
          const id = this.metadata.save({ item })
          await this.scoresFor({ itemId: id, imdbId: item.imdbId })
          return id
        } catch (error) {
          if (notFound(error)) return null
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
      this.settle({ mediaIds: [file.id], itemIds: [], match: 'unmatched' })
      return
    }

    const parsed = parseMovieName(file)
    const fromNames = async (): Promise<string | null> => {
      const fromName = await this.idFromIds({ ids: parsed.ids, type: 'movie' })
      if (fromName != null || assets.nfo == null) return fromName
      const nfoIds = await this.nfoIds({ path: join(dir, assets.nfo), context })
      return nfoIds ? this.idFromIds({ ids: nfoIds, type: 'movie' }) : null
    }
    const tmdbId =
      override ??
      (await fromNames()) ??
      (await this.search({ type: 'movie', title: file.title, year: file.year, context }))
    const itemId = tmdbId == null ? null : await this.ensure({ type: 'movie', tmdbId, context })
    if (itemId == null) {
      this.settle({ mediaIds: [file.id], itemIds: [], match: 'unmatched' })
      return
    }
    this.metadata.setLocalImages({
      itemId,
      images: {
        ...(assets.poster ? { poster: join(dir, assets.poster) } : {}),
        ...(assets.backdrop ? { backdrop: join(dir, assets.backdrop) } : {}),
      },
    })
    this.settle({
      mediaIds: [file.id],
      itemIds: [itemId],
      match: override != null ? 'manual' : 'matched',
    })
    this.warmPoster(itemId)
  }

  /**
   * The files of one show folder (or one file at a root): the show is found
   * once, then each file is placed in its season and episode.
   */
  private async matchShowGroup({
    files,
    context,
  }: {
    files: PendingFile[]
    context: PassContext
  }): Promise<void> {
    const extras = files.filter((file) => isExtra(file))
    if (extras.length > 0) this.media.setMatch({ ids: extras.map((file) => file.id), match: 'off' })
    const episodes = files.filter((file) => !isExtra(file))
    const [first] = episodes
    if (!first) return
    const mediaIds = episodes.map((file) => file.id)

    const root = rootOf(first)
    const fallbackShow = basename(root)
    const showFolder = showFolderOf(first)
    const showDir = showFolder == null ? dirname(first.path) : join(root, showFolder)
    const place = showPlace(first)
    const names = await this.names({ dir: showDir, context })
    const assets = showAssets(names)
    const parsed = parseEpisodeName({ ...first, fallbackShow })

    const override = this.metadata.override({ libraryId: first.libraryId, place })
    if (override === null) {
      this.settle({ mediaIds, itemIds: [], match: 'unmatched' })
      return
    }
    const fromNames = async (): Promise<string | null> => {
      const fromName = await this.idFromIds({ ids: parsed.ids, type: 'show' })
      if (fromName != null || assets.nfo == null) return fromName
      const nfoIds = await this.nfoIds({ path: join(showDir, assets.nfo), context })
      return nfoIds ? this.idFromIds({ ids: nfoIds, type: 'show' }) : null
    }
    const tmdbId =
      override ??
      (await fromNames()) ??
      (await this.search({ type: 'show', title: parsed.show, year: parsed.year, context }))
    const showId = tmdbId == null ? null : await this.ensure({ type: 'show', tmdbId, context })
    if (tmdbId == null || showId == null) {
      this.settle({ mediaIds, itemIds: [], match: 'unmatched' })
      return
    }
    this.metadata.setLocalImages({
      itemId: showId,
      images: {
        ...(assets.poster ? { poster: join(showDir, assets.poster) } : {}),
        ...(assets.backdrop ? { backdrop: join(showDir, assets.backdrop) } : {}),
      },
    })
    const match: MatchState = override != null ? 'manual' : 'matched'
    const show = { showId, showTmdbId: tmdbId, showDir, showNames: names, fallbackShow, match }
    await episodes.reduce(
      (previous, file) => previous.then(() => this.placeEpisode({ file, ...show, context })),
      Promise.resolve(),
    )
    this.warmPoster(showId)
  }

  /** Links one file to its episode (or episodes), making the season and episode when TMDB has none. */
  private async placeEpisode({
    file,
    showId,
    showTmdbId,
    showDir,
    showNames,
    fallbackShow,
    match,
    context,
  }: {
    file: PendingFile
    showId: number
    showTmdbId: string
    showDir: string
    showNames: string[]
    fallbackShow: string
    match: MatchState
    context: PassContext
  }): Promise<void> {
    const parsed = parseEpisodeName({ ...file, fallbackShow })
    if (parsed.season == null) {
      this.settle({ mediaIds: [file.id], itemIds: [showId], match })
      return
    }
    const season = await this.ensureSeason({ showId, showTmdbId, number: parsed.season, context })
    const dir = dirname(file.path)
    const ownNames = dir === showDir ? showNames : await this.names({ dir, context })
    // A season poster sits in the show's folder, or in the season's own.
    const inShowFolder = seasonPoster({ names: showNames, number: parsed.season })
    const poster = inShowFolder ?? seasonPoster({ names: ownNames, number: parsed.season })
    this.metadata.setLocalImages({
      itemId: season.id,
      images: poster ? { poster: join(inShowFolder ? showDir : dir, poster) } : {},
    })
    if (parsed.episodes.length === 0) {
      this.settle({ mediaIds: [file.id], itemIds: [season.id], match })
      return
    }
    const episodeIds = await parsed.episodes.reduce<Promise<number[]>>(
      (previous, number) =>
        previous.then(async (ids) => [
          ...ids,
          await this.episodeFor({
            season,
            showId,
            showTmdbId,
            number,
            title: parsed.title,
            context,
          }),
        ]),
      Promise.resolve([]),
    )
    const still = episodeStill({ names: ownNames, stem: stemOf(file.fileName) })
    const [firstEpisode] = episodeIds
    if (firstEpisode != null) {
      this.metadata.setLocalImages({
        itemId: firstEpisode,
        images: still ? { still: join(dir, still) } : {},
      })
    }
    this.settle({ mediaIds: [file.id], itemIds: episodeIds, match })
  }

  private episodesOf(seasonId: number): Map<number, number> {
    return new Map(
      this.metadata
        .children(seasonId)
        .flatMap((episode) =>
          episode.episode == null ? [] : [[episode.episode, episode.id] as const],
        ),
    )
  }

  /** Stores a season and its episodes as TMDB lists them, and answers with them by number. */
  private saveSeason({
    showId,
    fetched,
  }: {
    showId: number
    fetched: { season: FetchedItem; episodes: FetchedItem[] }
  }): SeasonData {
    const id = this.metadata.save({ item: fetched.season, parentId: showId })
    fetched.episodes.forEach((episode) => this.metadata.save({ item: episode, parentId: id }))
    return { id, number: fetched.season.number ?? 0, local: false, episodes: this.episodesOf(id) }
  }

  /**
   * A show's season, stored already, fetched once a pass, or made up when
   * TMDB has no such season.
   */
  private ensureSeason({
    showId,
    showTmdbId,
    number,
    context,
  }: {
    showId: number
    showTmdbId: string
    number: number
    context: PassContext
  }): Promise<SeasonData> {
    return remember({
      cache: context.seasons,
      key: `${showId}:${number}`,
      make: async () => {
        const stored = this.metadata.child({ parentId: showId, number })
        if (stored && !stored.tmdbId.startsWith(LOCAL)) {
          return { id: stored.id, number, local: false, episodes: this.episodesOf(stored.id) }
        }
        try {
          context.refetched.add(`${showId}:${number}`)
          return this.saveSeason({
            showId,
            fetched: await this.tmdb.season({ showTmdbId, number }),
          })
        } catch (error) {
          if (!notFound(error)) throw error
          const id =
            stored?.id ??
            this.metadata.save({ item: localSeason({ showTmdbId, number }), parentId: showId })
          return { id, number, local: true, episodes: this.episodesOf(id) }
        }
      },
    })
  }

  /**
   * The season's episode with `number`. One the stored season lacks makes
   * the season fetched again once a pass (it may have aired since), and
   * failing that is made up with the name the file gave.
   */
  private async episodeFor({
    season,
    showId,
    showTmdbId,
    number,
    title,
    context,
  }: {
    season: SeasonData
    showId: number
    showTmdbId: string
    number: number
    title: string | null
    context: PassContext
  }): Promise<number> {
    const known = season.episodes.get(number)
    if (known != null) return known
    const key = `${showId}:${season.number}`
    if (!season.local && !context.refetched.has(key)) {
      context.refetched.add(key)
      const fetched = await this.tmdb
        .season({ showTmdbId, number: season.number })
        .catch((error: unknown) => {
          if (notFound(error)) return null
          throw error
        })
      if (fetched) {
        this.saveSeason({ showId, fetched }).episodes.forEach((id, episodeNumber) =>
          season.episodes.set(episodeNumber, id),
        )
        const found = season.episodes.get(number)
        if (found != null) return found
      }
    }
    const id = this.metadata.save({
      item: localEpisode({ showTmdbId, season: season.number, number, title }),
      parentId: season.id,
    })
    season.episodes.set(number, id)
    return id
  }

  /** Links files to their items, or to none, and records how matching went. */
  private settle({
    mediaIds,
    itemIds,
    match,
  }: {
    mediaIds: readonly number[]
    itemIds: readonly number[]
    match: MatchState
  }): void {
    if (itemIds.length === 0) this.metadata.unlink(mediaIds)
    else this.metadata.link({ mediaIds, itemIds })
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

  /** Matches a set of files again from scratch, as one group, with a fresh pass. */
  private async rematch({
    files,
    kind,
  }: {
    files: PendingFile[]
    kind: LibraryKind
  }): Promise<void> {
    if (files.length === 0) return
    this.metadata.unlink(files.map((file) => file.id))
    this.media.setMatch({ ids: files.map((file) => file.id), match: 'pending' })
    const context = newContext()
    if (kind === 'shows') {
      await this.matchShowGroup({ files, context })
    } else {
      await files.reduce(
        (previous, file) => previous.then(() => this.matchMovie({ file, context })),
        Promise.resolve(),
      )
    }
  }

  /** The files a Fix match on `record` covers, and the place it is kept under. */
  private groupOf(record: PendingFile): { place: string; files: PendingFile[]; kind: LibraryKind } {
    const kind = this.libraries.get(record.libraryId)?.settings.kind ?? 'other'
    if (kind === 'shows') {
      const showFolder = showFolderOf(record)
      return {
        place: showPlace(record),
        kind,
        files:
          showFolder == null
            ? [record]
            : this.media.underFolder({ libraryId: record.libraryId, folder: showFolder }),
      }
    }
    const context = newContext()
    const own = this.ownFolder({ libraryId: record.libraryId, folder: record.folder, context })
    return {
      place: own ? record.folder : filePlace(record),
      kind,
      files: own
        ? this.media
            .inFolder({ libraryId: record.libraryId, folder: record.folder })
            .filter((file) => !isExtra(file))
        : [record],
    }
  }

  /**
   * Fix match: points a file, and the files kept with it (a movie's folder,
   * or a show's whole folder), at a TMDB movie or show, or at nothing for
   * `null`, and keeps that by place so renames and re-downloads keep it.
   */
  async fixMatch({ mediaId, tmdbId }: { mediaId: number; tmdbId: string | null }): Promise<void> {
    const record = this.media.get(mediaId)
    if (!record) return
    const group = this.groupOf(record)
    this.metadata.saveOverride({ libraryId: record.libraryId, place: group.place, tmdbId })
    await this.rematch({ files: group.files, kind: group.kind })
    await this.clearUp()
  }

  /**
   * Fix match for a show: every file under it, in every library, moves to
   * the show with `tmdbId`, keeping its numbers. Answers with the stored id
   * of the show they moved to, or null when TMDB has no such show.
   */
  async fixShowMatch({
    showId,
    tmdbId,
  }: {
    showId: number
    tmdbId: string
  }): Promise<number | null> {
    const files = this.metadata.mediaUnderShow(showId).flatMap((id) => this.media.get(id) ?? [])
    const groups = [...groupBy(files, (file) => `${file.libraryId}|${showPlace(file)}`).values()]
    await groups.reduce(
      (previous, group) => previous.then(() => this.rePoint({ group, tmdbId })),
      Promise.resolve(),
    )
    await this.clearUp()
    return this.metadata.find({ type: 'show', tmdbId })?.id ?? null
  }

  /** Keeps a Fix match for one show folder, and matches its files again under it. */
  private async rePoint({
    group,
    tmdbId,
  }: {
    group: PendingFile[]
    tmdbId: string
  }): Promise<void> {
    const [first] = group
    if (!first) return
    this.metadata.saveOverride({ libraryId: first.libraryId, place: showPlace(first), tmdbId })
    await this.rematch({ files: group, kind: 'shows' })
  }

  /**
   * Fetches an item again now: a movie or show with its pictures beside the
   * files read again, a show's seasons with it, a season with its episodes.
   * One TMDB no longer has goes, and its files go back to pending, or to
   * unmatched when a Fix match pointed there. False when it went.
   */
  async refresh(itemId: number): Promise<boolean> {
    const item = this.metadata.get(itemId)
    if (!item) return false
    if (item.tmdbId.startsWith(LOCAL)) return true
    try {
      if (item.type === 'movie') {
        const movie = await this.tmdb.movie(item.tmdbId)
        this.metadata.save({ item: movie })
        await this.rereadMovieImages(itemId)
        await this.scoresFor({ itemId, imdbId: movie.imdbId })
      } else if (item.type === 'show') {
        const show = await this.tmdb.show(item.tmdbId)
        this.metadata.save({ item: show })
        await this.refreshSeasons(itemId)
        await this.scoresFor({ itemId, imdbId: show.imdbId })
      } else if (item.type === 'season') {
        await this.refreshSeason(itemId)
      } else if (item.parentId != null) {
        await this.refreshSeason(item.parentId)
      }
    } catch (error) {
      if (!notFound(error)) throw error
      this.forget(itemId)
      return false
    }
    this.warmPoster(itemId)
    return true
  }

  private async refreshSeasons(showId: number): Promise<void> {
    await this.metadata
      .children(showId)
      .reduce(
        (previous, season) => previous.then(() => this.refreshSeason(season.id)),
        Promise.resolve(),
      )
  }

  /** Fetches one season again; a season TMDB has dropped, or a made-up one, is left as it is. */
  private async refreshSeason(seasonId: number): Promise<void> {
    const season = this.metadata.get(seasonId)
    if (!season || season.parentId == null || season.tmdbId.startsWith(LOCAL)) return
    const show = this.metadata.get(season.parentId)
    const number = this.metadata
      .children(season.parentId)
      .find((child) => child.id === seasonId)?.season
    if (!show || number == null) return
    const fetched = await this.tmdb
      .season({ showTmdbId: show.tmdbId, number })
      .catch((error: unknown) => {
        if (notFound(error)) return null
        throw error
      })
    if (fetched) this.saveSeason({ showId: show.id, fetched })
  }

  private async rereadMovieImages(itemId: number): Promise<void> {
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
  }

  private forget(itemId: number): void {
    const item = this.metadata.get(itemId)
    const mediaIds =
      item?.type === 'show' ? this.metadata.mediaUnderShow(itemId) : this.metadata.mediaFor(itemId)
    const files = mediaIds.flatMap((id) => this.media.get(id) ?? [])
    this.metadata.remove(itemId)
    const manual = files.filter((file) => file.match === 'manual').map((file) => file.id)
    const automatic = files.filter((file) => file.match !== 'manual').map((file) => file.id)
    this.media.setMatch({ ids: manual, match: 'unmatched' })
    this.media.setMatch({ ids: automatic, match: 'pending' })
    new Set(files.map((file) => file.libraryId)).forEach((libraryId) => this.enqueue(libraryId))
  }

  /**
   * Refreshes movies and shows fetched more than 30 days ago, or more than 7
   * days ago when they came out in the last 90 days or the show still airs.
   */
  async sweep(): Promise<void> {
    if (!this.tmdb.enabled) return
    const now = Date.now()
    const window = {
      before: new Date(now - 30 * DAY_MS).toISOString(),
      recentBefore: new Date(now - 7 * DAY_MS).toISOString(),
      releasedAfter: new Date(now - 90 * DAY_MS).toISOString().slice(0, 10),
    }
    const stale = [
      ...this.metadata.stale({ type: 'movie', ...window }),
      ...this.metadata.stale({ type: 'show', ...window }),
    ]
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
    await this.fillScores()
    await this.clearUp()
  }

  /**
   * IMDb, Rotten Tomatoes and Metacritic scores from OMDb, for a movie or
   * show with an IMDb id, while the key and today's calls allow. A call that
   * fails is noted on the client and tried again another day.
   */
  private async scoresFor({
    itemId,
    imdbId,
  }: {
    itemId: number
    imdbId: string | null
  }): Promise<void> {
    if (imdbId == null || !this.omdb.enabled) return
    try {
      this.metadata.saveScores({ itemId, scores: await this.omdb.ratings(imdbId) })
    } catch (error) {
      this.logger.warn(`No OMDb scores for ${imdbId}: ${message(error)}`)
    }
  }

  /** Items whose OMDb scores are missing or a month old, as far as today's calls go. */
  private async fillScores(): Promise<void> {
    if (!this.omdb.enabled) return
    const due = this.metadata.needingScores({
      before: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      limit: this.omdb.remaining(),
    })
    await due.reduce(
      (previous, item) =>
        previous.then(() =>
          this.omdb.enabled
            ? this.scoresFor({ itemId: item.id, imdbId: item.imdbId })
            : Promise.resolve(),
        ),
      Promise.resolve(),
    )
  }

  private async clearUp(): Promise<void> {
    await this.images.sweep(this.metadata.clearUp())
  }
}
