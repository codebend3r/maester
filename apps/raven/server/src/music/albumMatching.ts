import { Inject, Injectable, Logger } from '@nestjs/common'
import { type AlbumMatchCandidate, MATCH_STATES } from '@raven/core'
import { ServerEvents } from '@/events/serverEvents'
import { PassGuard } from '@/metadata/passGuard'
import { AlbumClaude } from '@/music/albumClaude'
import { artistToMatch } from '@/music/filing'
import {
  MUSICBRAINZ_ERROR_KINDS,
  MusicBrainzClient,
  MusicBrainzError,
  type Release,
} from '@/music/musicBrainzClient'
import { type AlbumToMatch, MusicMatchStore } from '@/music/musicMatchStore'
import { MusicRepository } from '@/music/musicRepository'
import {
  type Scored,
  type SearchTerms,
  candidatesOf,
  isSure,
  mergeScored,
  scoredOf,
  searchesFor,
} from '@/music/releaseScoring'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { ScanControl } from '@/scanner/scanControl'

/** Whether a MusicBrainz failure means the rest of a pass should wait for the next one. */
const isMusicBrainzAway = (error: unknown): boolean =>
  error instanceof MusicBrainzError && error.kind === MUSICBRAINZ_ERROR_KINDS.unavailable

/** The most track titles Claude is shown of an album, enough to know it by. */
const AI_TRACK_TITLES_MOST = 40

type AlbumMatchingSearchProps = {
  album: AlbumToMatch
  /** What to search for instead of the album's own title and artist. */
  query?: string
}

type AlbumMatchingFixProps = { id: number; mbid: string | null }

type AlbumMatchingSearchInTurnProps = { album: AlbumToMatch; searches: readonly SearchTerms[] }

/** How an album was matched, or that it was not. */
export const ALBUM_OUTCOMES = { matched: 'matched', unmatched: 'unmatched' } as const

/** What one album's search came to. */
export type AlbumOutcome =
  | {
      kind: typeof ALBUM_OUTCOMES.matched
      album: AlbumToMatch
      release: Release
      /** Whether Claude found or chose the release, as no search was sure of it. */
      isByClaude: boolean
    }
  | { kind: typeof ALBUM_OUTCOMES.unmatched; album: AlbumToMatch }

/** The release an album's searches settled on, and whether Claude had a hand in it. */
type Settled = { chosen: Scored; isByClaude: boolean }

/** Where an album's searches ended: the release settled on, if any, and the best found, for how close they came. */
type SettleResult = { settled: Settled | null; best?: Scored }

/**
 * How a pass went: of the `total` albums pending, how many it `searched`
 * and how many of those it `matched`. The rest failed or met MusicBrainz
 * away, and stay pending for the next pass.
 */
export type MatchTally = { matched: number; searched: number; total: number }

type AlbumMatchingMatchLibraryProps = {
  libraryId: number
  /** Told of each album as it is matched or not. */
  onOutcome?: (outcome: AlbumOutcome) => void
}

/** A pass with nothing to search. */
const NOTHING_PENDING: MatchTally = { matched: 0, searched: 0, total: 0 }

/**
 * Matches a music library's albums to MusicBrainz releases. An album whose
 * tags carry a release id is matched already; the rest are searched by
 * album artist and title, then by the title with its edition taken off and
 * by what the album's folder names (`searchesFor`), and only a sure answer
 * (`CONFIDENCE_STRONG`) is taken, as the films' matching takes only a sure
 * one. With an AI key, Claude picks among the releases found when none is
 * sure, and suggests a search when that came to nothing (`AlbumClaude`). A
 * matched album with no cover of its own shows the Cover Art Archive's, by
 * the release id, fetched on first use.
 */
@Injectable()
export class AlbumMatching {
  private readonly logger = new Logger(AlbumMatching.name)

  constructor(
    @Inject(MusicBrainzClient) private readonly musicBrainz: MusicBrainzClient,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(MusicMatchStore) private readonly matches: MusicMatchStore,
    @Inject(AlbumClaude) private readonly claude: AlbumClaude,
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(ScanControl) private readonly scans: ScanControl,
  ) {}

  /** MusicBrainz's releases for an album's Fix match, scored against it, best first. */
  async search({ album, query }: AlbumMatchingSearchProps): Promise<AlbumMatchCandidate[]> {
    const releases = await this.musicBrainz.searchReleases(
      query === undefined
        ? { album: album.title, artist: artistToMatch(album) }
        : { album: query, artist: null },
    )
    return candidatesOf({ album, releases })
  }

  /**
   * Runs `searches` one after another, as MusicBrainz takes one request a
   * second, until one finds a release it is sure of; every release found,
   * best first.
   */
  private async searchInTurn({
    album,
    searches,
  }: AlbumMatchingSearchInTurnProps): Promise<Scored[]> {
    return searches.reduce<Promise<Scored[]>>(async (sofar, terms) => {
      const found = await sofar
      if (isSure(found[0])) return found
      const releases = await this.musicBrainz.searchReleases(terms)
      return mergeScored({ found, more: scoredOf({ album, releases }) })
    }, Promise.resolve([]))
  }

  /** What a search Claude suggests finds: a sure release, or Claude's pick of what it found. */
  private async bySuggestion(album: AlbumToMatch): Promise<Scored | null> {
    const tracks = this.matches.trackTitlesOf({ id: album.id, most: AI_TRACK_TITLES_MOST })
    const suggested = await this.claude.suggest({ album, tracks })
    if (suggested === null) return null
    const found = await this.searchInTurn({ album, searches: [suggested] })
    return isSure(found[0]) ? found[0] : this.claude.pick({ album, scored: found })
  }

  /**
   * The release an album is, and the best its searches found for how close
   * they came: the first sure release they find; else Claude's pick of them;
   * else what a search Claude suggests comes to.
   */
  private async settle(album: AlbumToMatch): Promise<SettleResult> {
    const found = await this.searchInTurn({ album, searches: searchesFor(album) })
    const [best] = found
    if (isSure(best)) return { settled: { chosen: best, isByClaude: false }, best }
    const chosen =
      (await this.claude.pick({ album, scored: found })) ?? (await this.bySuggestion(album))
    return { settled: chosen === null ? null : { chosen, isByClaude: true }, best }
  }

  /** One album searched and its answer saved: the release it is, or unmatched with how close the best came. */
  private async matchOne(album: AlbumToMatch): Promise<AlbumOutcome> {
    const { settled, best } = await this.settle(album)
    this.matches.saveMatch({
      id: album.id,
      release: settled?.chosen.release ?? null,
      match: settled === null ? MATCH_STATES.unmatched : MATCH_STATES.matched,
      confidence: settled?.chosen.confidence ?? best?.confidence ?? 0,
    })
    if (settled === null) return { kind: ALBUM_OUTCOMES.unmatched, album }
    return {
      kind: ALBUM_OUTCOMES.matched,
      album,
      release: settled.chosen.release,
      isByClaude: settled.isByClaude,
    }
  }

  /**
   * Searches for each of the library's albums still pending, one at a
   * time, since MusicBrainz takes one request a second, and fills in the
   * matched albums MusicBrainz has not been read for. MusicBrainz going away
   * ends the pass with what it matched by then; the rest stay pending for
   * the next one.
   */
  private async matchPending({
    libraryId,
    onOutcome = () => undefined,
  }: AlbumMatchingMatchLibraryProps): Promise<MatchTally> {
    const pending = this.matches.albumsToMatch(libraryId)
    const enrichment = this.matches.albumsToEnrich(libraryId)
    if (pending.length === 0 && enrichment.length === 0) return NOTHING_PENDING
    const guard = new PassGuard({
      logger: this.logger,
      failed: 'Could not match an album',
      stopped: 'MusicBrainz stopped the pass',
      signal: this.scans.signal,
      stops: isMusicBrainzAway,
    })
    const outcomes = await mapWithConcurrency({
      items: pending,
      limit: 1,
      fn: (album) =>
        guard.run(async () => {
          const outcome = await this.matchOne(album)
          onOutcome(outcome)
          return outcome
        }),
    })
    const searched = outcomes.flatMap((outcome) => (outcome === undefined ? [] : [outcome]))
    await mapWithConcurrency({
      items: enrichment,
      limit: 1,
      fn: async ({ id, mbid }) =>
        guard.run(async () => {
          const release = await this.musicBrainz.release(mbid)
          this.matches.enrich({ id, release })
        }),
    })
    guard.reportStop()
    return {
      matched: searched.filter(({ kind }) => kind === ALBUM_OUTCOMES.matched).length,
      searched: searched.length,
      total: pending.length,
    }
  }

  /** A pass over the library's pending albums, then the duplicates folded; how it went. */
  async matchLibrary(props: AlbumMatchingMatchLibraryProps): Promise<MatchTally> {
    const tally = await this.matchPending(props)
    if (tally.total === 0) return tally
    const merged = this.matches.mergeAlbums(props.libraryId)
    this.events.libraryChanged(props.libraryId)
    this.logger.log(
      `Matched ${tally.matched} of ${tally.total} albums of library ${props.libraryId}; merged ${merged} duplicates`,
    )
    return tally
  }

  /** The albums no release was found for are searched again on the next pass. */
  retry(libraryId: number): number {
    return this.matches.resetUnmatched(libraryId)
  }

  /**
   * A Fix match: the album is the release `mbid` names, read from
   * MusicBrainz, or none at all. Kept through rescans, and never replaced
   * by a pass. Whether there was such an album.
   */
  async fix({ id, mbid }: AlbumMatchingFixProps): Promise<boolean> {
    const libraryId = this.music.libraryOfAlbum(id)
    if (libraryId === null) return false
    const release = mbid === null ? null : await this.musicBrainz.release(mbid)
    this.matches.saveMatch({ id, release, match: MATCH_STATES.manual, confidence: null })
    this.events.libraryChanged(libraryId)
    return true
  }
}
