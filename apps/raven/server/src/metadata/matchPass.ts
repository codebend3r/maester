import type { Logger } from '@nestjs/common'
import {
  type CandidateTier,
  foldTitle,
  type MatchItemType,
  type NameIds,
  sortTitle,
} from '@raven/core'
import { FolderReader } from '@/metadata/folderReader'
import { isLocal, localEpisode, localSeason } from '@/metadata/localItems'
import type { FixMatch, MatchFiles } from '@/metadata/matchFiles'
import { pickByTiers, pickMatch } from '@/metadata/matcher'
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

/** How many of a search's results have their alternative titles looked up. */
const ALIAS_LOOKUPS = 5

/** How far from the name's year a result can be to have them looked up: as far as `pickMatch` reaches. */
const ALIAS_YEARS_APART = 3

/**
 * How soon a result's other titles are looked up: 0 when a title starts with
 * the name's words (Archie (2023) is "Archie: The Man Who Became Cary Grant"
 * in its own country), 1 when none contains the name, so TMDB found it by an
 * alternative title ("Expired" finds Loveland), 2 when one holds it mid-title.
 */
const aliasTier = ({ result, name }: { result: SearchResult; name: string }): 0 | 1 | 2 => {
  const titles = [result.title, result.originalTitle].flatMap((title) =>
    title == null ? [] : [`${foldTitle(title)} `],
  )
  if (titles.some((title) => title.startsWith(`${name} `))) return 0
  if (titles.some((title) => ` ${title}`.includes(` ${name} `))) return 2
  return 1
}

/** A title to search TMDB for, with what narrows it. */
export type SearchTitle = { title: string; year: number | null; country?: string | null }

/** How a movie or show came out: the item it is, and whether a Fix match said so. */
export type Resolved =
  | { kind: 'unmatched' }
  | { kind: 'matched'; itemId: number; tmdbId: string; match: 'manual' | 'matched' }

export type MatchPassDeps = {
  /** The library's tiers, from `tiersFor`: every search in the pass prefers them in order. */
  prefer: readonly CandidateTier[]
  tmdb: TmdbClient
  metadata: MetadataRepository
  files: MatchFiles
  scores: OmdbScores
  logger: Logger
}

/**
 * One matching pass: what it has read, searched and fetched, so a folder is
 * read, a title searched and a season fetched once however many files ask,
 * and the guard that stops it when TMDB goes away. A pass serves one library,
 * so its searches, cached by title, are picked with that library's tiers.
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
   * sure answer, then the AI lookup's sure pick. Unmatched when the Fix match
   * says it is none, nothing is found, or TMDB has no such item.
   */
  async resolve({
    type,
    fix,
    ids,
    nfoPath,
    titles,
    decided = null,
  }: {
    type: MatchItemType
    fix: FixMatch
    ids: NameIds
    nfoPath: string | null
    titles: readonly SearchTitle[]
    /** The TMDB id the AI lookup chose for the group, being sure; null when it was not asked, unsure, or chose nothing. */
    decided?: string | null
  }): Promise<Resolved> {
    if (fix.kind === 'not-a-match') return { kind: 'unmatched' }
    const tmdbId =
      fix.kind === 'tmdb'
        ? fix.tmdbId
        : ((await this.fromIds({ type, ids, nfoPath })) ??
          (await this.searchEach({ type, titles })) ??
          decided)
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
        const ask = ({
          query,
          includeAdult = false,
        }: {
          query: string
          includeAdult?: boolean
        }): Promise<SearchResult[]> =>
          type === 'movie'
            ? tmdb.searchMovies({ query, year, includeAdult })
            : tmdb.searchShows({ query, year })
        const pick = (
          extra: Omit<Parameters<typeof pickMatch>[0], 'type' | 'title' | 'year' | 'country'>,
        ): string | null =>
          pickByTiers({ type, title, year, country, prefer: this.deps.prefer, ...extra })?.tmdbId ??
          null

        const results = await ask({ query: title })
        // TMDB finds nothing for "The Few Good Men"; without the article it
        // offers "A Few Good Men", which folds to the same title.
        const bare = sortTitle(title)
        const retried =
          results.length === 0 && bare !== title ? await ask({ query: bare }) : results
        const sure = pick({ results: retried })
        if (sure != null) return sure
        // TMDB's search reads alternative titles too, so "Expired" finds
        // Loveland (2022), the name it was released under abroad.
        const aliased = pick({
          results: retried,
          aliases: await this.aliasesOf({ type, title, year, results: retried }),
        })
        if (aliased != null || type !== 'movie') return aliased
        // TMDB leaves some films out of a search without adult titles though
        // it does not mark them adult, as with "Paprika" (1991). Only the
        // same title counts there, never a lone result of another.
        return pick({
          results: await ask({ query: title, includeAdult: true }),
          canTakeLoneResult: false,
        })
      },
    })
  }

  /**
   * The other titles TMDB knows the results near `year` by, the first few of
   * them: those whose titles start with the name first, then those that do
   * not contain it, then the rest, each in TMDB's order, so a short name with
   * many near matches still reaches the one it is short for.
   */
  private async aliasesOf({
    type,
    title,
    year,
    results,
  }: {
    type: MatchItemType
    title: string
    year: number | null
    results: readonly SearchResult[]
  }): Promise<Map<string, string[]>> {
    const name = foldTitle(title)
    const near = results
      .filter(
        (result) =>
          year == null ||
          (result.year != null && Math.abs(result.year - year) <= ALIAS_YEARS_APART),
      )
      .toSorted((a, b) => aliasTier({ result: a, name }) - aliasTier({ result: b, name }))
      .slice(0, ALIAS_LOOKUPS)
    const found = await Promise.all(
      near.map(async (result) => {
        const titles = await this.deps.tmdb
          .alternativeTitles({ type, tmdbId: result.tmdbId })
          .catch((error: unknown) => {
            if (notFound(error)) return []
            throw error
          })
        return [result.tmdbId, titles] as const
      }),
    )
    return new Map(found)
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
