import { Inject, Injectable, Logger } from '@nestjs/common'
import { type AlbumMatchCandidate, CONFIDENCE_STRONG, MATCH_STATES, foldTitle } from '@raven/core'
import { ServerEvents } from '@/events/serverEvents'
import { PassGuard } from '@/metadata/passGuard'
import { artistToMatch } from '@/music/filing'
import {
  MUSICBRAINZ_ERROR_KINDS,
  MusicBrainzClient,
  MusicBrainzError,
  type Release,
} from '@/music/musicBrainzClient'
import { type AlbumToMatch, MusicRepository } from '@/music/musicRepository'
import { mapWithConcurrency } from '@/scanner/concurrency'

/** What each fact is worth when a release agrees with the album, out of 100. */
const WEIGHTS = {
  title: 45,
  artist: 30,
  year: 10,
  yearNear: 5,
  trackCount: 10,
  official: 5,
} as const

type ScoreProps = { album: AlbumToMatch; release: Release }

/** Whether the release credits the album's artist, alone or among others. */
const creditsArtist = ({ album, release }: ScoreProps): boolean => {
  const wanted = artistToMatch(album)
  if (wanted === null) return false
  const folded = foldTitle(wanted)
  return (
    foldTitle(release.artist) === folded ||
    release.artists.some((artist) => foldTitle(artist.name) === folded)
  )
}

/**
 * How sure raven is that `release` is the album, 0 to 100: the title and
 * the artist count most, then the year (one either side half counts, as
 * releases differ by country) and the track count, and an official release
 * edges out a bootleg of the same name. A compilation has no artist to
 * agree on, so its artist's share rides on the title. Every pressing of
 * one release scores alike; the pass takes MusicBrainz's first, since they
 * are the same album.
 */
export const scoreRelease = ({ album, release }: ScoreProps): number => {
  const isSameTitle = foldTitle(release.title) === foldTitle(album.title)
  const isSameArtist =
    artistToMatch(album) === null ? isSameTitle : creditsArtist({ album, release })
  const apart =
    album.year === null || release.year === null ? null : Math.abs(album.year - release.year)
  const score =
    (isSameTitle ? WEIGHTS.title : 0) +
    (isSameArtist ? WEIGHTS.artist : 0) +
    (apart === 0 ? WEIGHTS.year : apart === 1 ? WEIGHTS.yearNear : 0) +
    (release.trackCount !== null && release.trackCount === album.trackCount
      ? WEIGHTS.trackCount
      : 0) +
    (release.isOfficial ? WEIGHTS.official : 0)
  return Math.min(100, score)
}

type Scored = { release: Release; confidence: number }

type ScoredOfProps = { album: AlbumToMatch; releases: readonly Release[] }

/** The releases scored against the album, best first; MusicBrainz's own relevance breaks a tie. */
const scoredOf = ({ album, releases }: ScoredOfProps): Scored[] =>
  releases
    .map((release) => ({ release, confidence: scoreRelease({ album, release }) }))
    .toSorted((a, b) => b.confidence - a.confidence || b.release.score - a.release.score)

type ToCandidateProps = Scored

const toCandidate = ({ release, confidence }: ToCandidateProps): AlbumMatchCandidate => ({
  mbid: release.mbid,
  title: release.title,
  artist: release.artist,
  year: release.year,
  trackCount: release.trackCount,
  type: release.type,
  country: release.country,
  confidence,
})

/** Releases as Fix match offers them: scored against the album, best first. */
export const candidatesOf = (props: ScoredOfProps): AlbumMatchCandidate[] =>
  scoredOf(props).map(toCandidate)

/** Whether a MusicBrainz failure means the rest of a pass should wait for the next one. */
const isMusicBrainzAway = (error: unknown): boolean =>
  error instanceof MusicBrainzError && error.kind === MUSICBRAINZ_ERROR_KINDS.unavailable

type AlbumMatchingSearchProps = {
  album: AlbumToMatch
  /** What to search for instead of the album's own title and artist. */
  query?: string
}

type AlbumMatchingFixProps = { id: number; mbid: string | null }

/**
 * Matches a music library's albums to MusicBrainz releases. An album whose
 * tags carry a release id is matched already; the rest are searched by
 * album artist and title, and only a sure answer (`CONFIDENCE_STRONG`) is
 * taken, as the films' matching takes only a sure one. A matched album
 * with no cover of its own shows the Cover Art Archive's, by the release
 * id, fetched on first use.
 */
@Injectable()
export class AlbumMatching {
  private readonly logger = new Logger(AlbumMatching.name)

  constructor(
    @Inject(MusicBrainzClient) private readonly musicBrainz: MusicBrainzClient,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(ServerEvents) private readonly events: ServerEvents,
  ) {}

  /** MusicBrainz's releases for an album, scored against it, best first. */
  private async searchScored({ album, query }: AlbumMatchingSearchProps): Promise<Scored[]> {
    const releases = await this.musicBrainz.searchReleases(
      query === undefined
        ? { album: album.title, artist: artistToMatch(album) }
        : { album: query, artist: null },
    )
    return scoredOf({ album, releases })
  }

  /** MusicBrainz's releases for an album's Fix match, scored against it, best first. */
  async search(props: AlbumMatchingSearchProps): Promise<AlbumMatchCandidate[]> {
    return (await this.searchScored(props)).map(toCandidate)
  }

  /**
   * One album: the search's best release when it is sure, which holds
   * everything the album takes from MusicBrainz, so no lookup follows; else
   * unmatched, with how close the best came. Whether it was sure.
   */
  private async matchOne(album: AlbumToMatch): Promise<boolean> {
    const [best] = await this.searchScored({ album })
    const isSure = best !== undefined && best.confidence >= CONFIDENCE_STRONG
    this.music.saveMatch({
      id: album.id,
      release: isSure ? best.release : null,
      match: isSure ? MATCH_STATES.matched : MATCH_STATES.unmatched,
      confidence: best?.confidence ?? 0,
    })
    return isSure
  }

  /**
   * Searches for each of the library's albums still pending, one at a
   * time, since MusicBrainz takes one request a second. MusicBrainz going
   * away ends the pass with what it matched by then; the rest stay pending
   * for the next scan.
   */
  async matchLibrary(libraryId: number): Promise<void> {
    const pending = this.music.albumsToMatch(libraryId)
    if (pending.length === 0) return
    const guard = new PassGuard({
      logger: this.logger,
      failed: 'Could not match an album',
      stopped: 'MusicBrainz stopped the pass',
      stops: isMusicBrainzAway,
    })
    const outcomes = await mapWithConcurrency({
      items: pending,
      limit: 1,
      fn: async (album) => {
        const done = { isMatched: false }
        await guard.run(async () => {
          done.isMatched = await this.matchOne(album)
        })
        return done.isMatched
      },
    })
    guard.reportStop()
    const matched = outcomes.filter(Boolean).length
    this.events.libraryChanged(libraryId)
    this.logger.log(`Matched ${matched} of ${pending.length} albums of library ${libraryId}`)
  }

  /** The albums no release was found for are searched again on the next pass. */
  retry(libraryId: number): number {
    return this.music.resetUnmatched(libraryId)
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
    this.music.saveMatch({ id, release, match: MATCH_STATES.manual, confidence: null })
    this.events.libraryChanged(libraryId)
    return true
  }
}
