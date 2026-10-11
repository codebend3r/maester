import type { Logger } from '@nestjs/common'
import { foldTitle, type MatchItemType, type NameIds, sortTitle } from '@raven/core'
import { FolderReader } from '@/metadata/folderReader'
import { isLocal, localEpisode, localSeason } from '@/metadata/localItems'
import type { FixMatch, MatchFiles } from '@/metadata/matchFiles'
import { pickMatch } from '@/metadata/matcher'
import type { MetadataRepository } from '@/metadata/metadataRepository'
import { readNfoIds } from '@/metadata/nfo'
import type { OmdbScores } from '@/metadata/omdbScores'
import { OnceEach } from '@/metadata/onceEach'
import { PassGuard } from '@/metadata/passGuard'
import { type SearchResult, type TmdbClient, TmdbError } from '@/metadata/tmdbClient'

export const notFound = (error: unknown): boolean =>
  error instanceof TmdbError && error.kind === 'not-found'

/** A stored season, its number, and its episodes by number. */
export type SeasonData = {
  id: number
  number: number
  local: boolean
  episodes: Map<number, number>
}

/** A title to search TMDB for, with what narrows it. */
export type SearchTitle = { title: string; year: number | null; country?: string | null }

/** How a movie or show came out: the item it is, and whether a Fix match said so. */
export type Resolved =
  | { kind: 'unmatched' }
  | { kind: 'matched'; itemId: number; tmdbId: string; match: 'manual' | 'matched' }

export type MatchPassDeps = {
  tmdb: TmdbClient
  metadata: MetadataRepository
  files: MatchFiles
  scores: OmdbScores
  logger: Logger
}

/**
 * One matching pass: what it has read, searched and fetched, so a folder is
 * read, a title searched and a season fetched once however many files ask,
 * and the guard that stops it when TMDB goes away.
 */
export class MatchPass {
  readonly folders: FolderReader
  readonly guard: PassGuard
  private readonly searches = new OnceEach<Promise<string | null>>()
  private readonly fetches = new OnceEach<Promise<number | null>>()
  private readonly seasons = new OnceEach<Promise<SeasonData>>()
  private readonly nfos = new OnceEach<Promise<NameIds | null>>()
  /** Seasons fetched this pass, so an episode a season lacks fetches it again at most once. */
  private readonly refetched = new Set<string>()

  constructor(private readonly deps: MatchPassDeps) {
    this.folders = new FolderReader(deps.files)
    this.guard = new PassGuard({
      logger: deps.logger,
      failed: 'Could not match',
      stopped: 'Matching stopped for now',
    })
  }

  /**
   * The movie or show a set of files is: a Fix match wins, then an id in a
   * name or NFO, then a search for each of `titles` in turn that only takes a
   * sure answer. Unmatched when the Fix match says it is none, nothing is
   * found, or TMDB has no such item.
   */
  async resolve({
    type,
    fix,
    ids,
    nfoPath,
    titles,
  }: {
    type: MatchItemType
    fix: FixMatch
    ids: NameIds
    nfoPath: string | null
    titles: readonly SearchTitle[]
  }): Promise<Resolved> {
    if (fix.kind === 'not-a-match') return { kind: 'unmatched' }
    const tmdbId =
      fix.kind === 'tmdb'
        ? fix.tmdbId
        : ((await this.fromIds({ type, ids, nfoPath })) ??
          (await this.searchEach({ type, titles })))
    const itemId = tmdbId == null ? null : await this.ensure({ type, tmdbId })
    if (tmdbId == null || itemId == null) return { kind: 'unmatched' }
    return { kind: 'matched', itemId, tmdbId, match: fix.kind === 'tmdb' ? 'manual' : 'matched' }
  }

  /** The id a name gives, or else the NFO beside it. */
  private async fromIds({
    type,
    ids,
    nfoPath,
  }: {
    type: MatchItemType
    ids: NameIds
    nfoPath: string | null
  }): Promise<string | null> {
    const fromName = await this.idFromIds({ ids, type })
    if (fromName != null || nfoPath == null) return fromName
    const nfoIds = await this.nfos.get({ key: nfoPath, make: () => readNfoIds(nfoPath) })
    return nfoIds ? this.idFromIds({ ids: nfoIds, type }) : null
  }

  /** TMDB's id for the first id a name or NFO gives, as a movie or a show. */
  private async idFromIds({
    ids,
    type,
  }: {
    ids: NameIds
    type: MatchItemType
  }): Promise<string | null> {
    if (ids.tmdb != null) return ids.tmdb
    const { tmdb } = this.deps
    const pick = (found: { movies: string[]; shows: string[] }): string | null =>
      (type === 'movie' ? found.movies[0] : found.shows[0]) ?? null
    if (type === 'show' && ids.tvdb != null) {
      return pick(await tmdb.find({ id: ids.tvdb, source: 'tvdb_id' }))
    }
    if (ids.imdb != null) return pick(await tmdb.find({ id: ids.imdb, source: 'imdb_id' }))
    if (ids.tvdb != null) return pick(await tmdb.find({ id: ids.tvdb, source: 'tvdb_id' }))
    return null
  }

  /** The first of `titles` a search finds a sure answer for. */
  private searchEach({
    type,
    titles,
  }: {
    type: MatchItemType
    titles: readonly SearchTitle[]
  }): Promise<string | null> {
    return titles.reduce<Promise<string | null>>(
      (previous, title) => previous.then((found) => found ?? this.search({ type, ...title })),
      Promise.resolve(null),
    )
  }

  private search({
    type,
    title,
    year,
    country = null,
  }: {
    type: MatchItemType
    title: string
    year: number | null
    country?: string | null
  }): Promise<string | null> {
    const { tmdb } = this.deps
    return this.searches.get({
      key: `${type}|${foldTitle(title)}|${year ?? ''}|${country ?? ''}`,
      make: async () => {
        const ask = (query: string): Promise<SearchResult[]> =>
          type === 'movie' ? tmdb.searchMovies({ query, year }) : tmdb.searchShows({ query, year })
        const results = await ask(title)
        // TMDB finds nothing for "The Few Good Men"; without the article it
        // offers "A Few Good Men", which folds to the same title.
        const bare = sortTitle(title)
        const retried = results.length === 0 && bare !== title ? await ask(bare) : results
        return pickMatch({ type, title, year, country, results: retried })?.tmdbId ?? null
      },
    })
  }

  /** The stored movie or show for a TMDB id, fetched first when raven does not have it; null when TMDB has no such one. */
  private ensure({
    type,
    tmdbId,
  }: {
    type: MatchItemType
    tmdbId: string
  }): Promise<number | null> {
    const { tmdb, metadata, scores } = this.deps
    return this.fetches.get({
      key: `${type}:${tmdbId}`,
      make: async () => {
        const stored = metadata.find({ type, tmdbId })
        if (stored) return stored.id
        try {
          const item = type === 'movie' ? await tmdb.movie(tmdbId) : await tmdb.show(tmdbId)
          const id = metadata.save({ item })
          await scores.fetch({ itemId: id, imdbId: item.imdbId })
          return id
        } catch (error) {
          if (notFound(error)) return null
          throw error
        }
      },
    })
  }

  /**
   * A show's season, stored already, fetched once a pass, or made up when
   * TMDB has no such season.
   */
  ensureSeason({
    showId,
    showTmdbId,
    number,
  }: {
    showId: number
    showTmdbId: string
    number: number
  }): Promise<SeasonData> {
    const { tmdb, metadata } = this.deps
    return this.seasons.get({
      key: `${showId}:${number}`,
      make: async () => {
        const stored = metadata.child({ parentId: showId, number })
        if (stored && !isLocal(stored.tmdbId)) {
          return { id: stored.id, number, local: false, episodes: metadata.childNumbers(stored.id) }
        }
        try {
          this.refetched.add(`${showId}:${number}`)
          const fetched = await tmdb.season({ showTmdbId, number })
          return { ...metadata.saveSeason({ showId, number, ...fetched }), local: false }
        } catch (error) {
          if (!notFound(error)) throw error
          const id =
            stored?.id ??
            metadata.save({ item: localSeason({ showTmdbId, number }), parentId: showId })
          return { id, number, local: true, episodes: metadata.childNumbers(id) }
        }
      },
    })
  }

  /**
   * The season's episode with `number`. One the stored season lacks makes
   * the season fetched again once a pass (it may have aired since), and
   * failing that is made up with the name the file gave.
   */
  async episodeFor({
    season,
    showId,
    showTmdbId,
    number,
    title,
  }: {
    season: SeasonData
    showId: number
    showTmdbId: string
    number: number
    title: string | null
  }): Promise<number> {
    const { tmdb, metadata } = this.deps
    const known = season.episodes.get(number)
    if (known != null) return known
    const key = `${showId}:${season.number}`
    if (!season.local && !this.refetched.has(key)) {
      this.refetched.add(key)
      const fetched = await tmdb
        .season({ showTmdbId, number: season.number })
        .catch((error: unknown) => {
          if (notFound(error)) return null
          throw error
        })
      if (fetched) {
        metadata
          .saveSeason({ showId, number: season.number, ...fetched })
          .episodes.forEach((id, episodeNumber) => season.episodes.set(episodeNumber, id))
        const found = season.episodes.get(number)
        if (found != null) return found
      }
    }
    const id = metadata.save({
      item: localEpisode({ showTmdbId, season: season.number, number, title }),
      parentId: season.id,
    })
    season.episodes.set(number, id)
    return id
  }
}
