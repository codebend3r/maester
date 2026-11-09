import { type AlbumMatchCandidate, CONFIDENCE_STRONG, foldTitle } from '@raven/core'
import { plainAlbumTitle } from '@/music/albumTitles'
import { artistToMatch } from '@/music/filing'
import type { Release } from '@/music/musicBrainzClient'
import type { AlbumToMatch } from '@/music/musicRepository'

/** What each fact is worth when a release agrees with the album, out of 100. */
const WEIGHTS = {
  title: 45,
  artist: 30,
  year: 10,
  yearNear: 5,
  trackCount: 10,
  official: 5,
} as const

type CreditsArtistProps = { album: AlbumToMatch; release: Release }

/** The artists an album may be credited to: its first album artist's, and the one its folder names. */
const artistsToMatch = (album: AlbumToMatch): string[] =>
  [artistToMatch(album), album.folder?.artist ?? null].flatMap((name) =>
    name === null ? [] : [foldTitle(name)],
  )

/** Whether the release credits the album's artist, alone or among others. */
const creditsArtist = ({ album, release }: CreditsArtistProps): boolean => {
  const wanted = artistsToMatch(album)
  const credited = new Set(
    [release.artist, ...release.artists.map((artist) => artist.name)].map(foldTitle),
  )
  return wanted.some((name) => credited.has(name))
}

/** The names an album may go by, folded: its tag, the tag with its edition taken off, and its folder's. */
const titlesToMatch = (album: AlbumToMatch): Set<string> =>
  new Set(
    [album.title, plainAlbumTitle(album.title), album.folder?.title ?? '']
      .map(foldTitle)
      .filter((title) => title !== ''),
  )

type ScoreReleaseProps = { album: AlbumToMatch; release: Release }

/** The year's share for releases `apart` years from the album, nothing when either has no year. */
const yearPoints = (apart: number | null): number => {
  if (apart === 0) return WEIGHTS.year
  return apart === 1 ? WEIGHTS.yearNear : 0
}

/**
 * How sure raven is that `release` is the album, 0 to 100: the title and
 * the artist count most, then the year (one either side half counts, as
 * releases differ by country) and the track count, and an official release
 * edges out a bootleg of the same name. A title counts with its edition
 * taken off on either side, or as the album's folder names it, so "Pac's
 * Life (Bonus Track)" is MusicBrainz's "Pac's Life". A compilation has no
 * artist to agree on, so its artist's share rides on the title. Every
 * pressing of one release scores alike; the pass takes MusicBrainz's first,
 * since they are the same album.
 */
export const scoreRelease = ({ album, release }: ScoreReleaseProps): number => {
  const titles = titlesToMatch(album)
  const isSameTitle =
    titles.has(foldTitle(release.title)) || titles.has(foldTitle(plainAlbumTitle(release.title)))
  const isSameArtist =
    artistsToMatch(album).length === 0 ? isSameTitle : creditsArtist({ album, release })
  const apart =
    album.year === null || release.year === null ? null : Math.abs(album.year - release.year)
  const score =
    (isSameTitle ? WEIGHTS.title : 0) +
    (isSameArtist ? WEIGHTS.artist : 0) +
    yearPoints(apart) +
    (release.trackCount !== null && release.trackCount === album.trackCount
      ? WEIGHTS.trackCount
      : 0) +
    (release.isOfficial ? WEIGHTS.official : 0)
  return Math.min(100, score)
}

/** A release with how sure raven is that it is the album. */
export type Scored = { release: Release; confidence: number }

/** Best first; MusicBrainz's own relevance breaks a tie. */
const byConfidence = (a: Scored, b: Scored): number =>
  b.confidence - a.confidence || b.release.score - a.release.score

type ScoredOfProps = { album: AlbumToMatch; releases: readonly Release[] }

/** The releases scored against the album, best first. */
export const scoredOf = ({ album, releases }: ScoredOfProps): Scored[] =>
  releases
    .map((release) => ({ release, confidence: scoreRelease({ album, release }) }))
    .toSorted(byConfidence)

const toCandidate = ({ release, confidence }: Scored): AlbumMatchCandidate => ({
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

/** One search of MusicBrainz: an album's title, and its artist when one is known. */
export type SearchTerms = { album: string; artist: string | null }

type DistinctSearchesProps = { searches: readonly SearchTerms[] }

/** The searches, each once however its words are spelled. */
const distinctSearches = ({ searches }: DistinctSearchesProps): SearchTerms[] =>
  searches.filter(
    (search, at) =>
      foldTitle(search.album) !== '' &&
      searches.findIndex(
        (other) =>
          foldTitle(other.album) === foldTitle(search.album) &&
          foldTitle(other.artist ?? '') === foldTitle(search.artist ?? ''),
      ) === at,
  )

/**
 * What to search MusicBrainz for, in turn, until one finds the album: its
 * tags as they are, its title with the edition taken off, and what its
 * folder's name says.
 */
export const searchesFor = (album: AlbumToMatch): SearchTerms[] => {
  const artist = artistToMatch(album)
  return distinctSearches({
    searches: [
      { album: album.title, artist },
      { album: plainAlbumTitle(album.title), artist },
      ...(album.folder === null
        ? []
        : [{ album: album.folder.title, artist: album.folder.artist ?? artist }]),
    ],
  })
}

type MergeScoredProps = { found: readonly Scored[]; more: readonly Scored[] }

/** Two searches' releases as one list, each release once, best first. */
export const mergeScored = ({ found, more }: MergeScoredProps): Scored[] =>
  [
    ...found,
    ...more.filter(({ release }) => !found.some((seen) => seen.release.mbid === release.mbid)),
  ].toSorted(byConfidence)

/** Whether raven is sure enough of a release to take it with no one asked. */
export const isSure = (scored: Scored | undefined): scored is Scored =>
  scored !== undefined && scored.confidence >= CONFIDENCE_STRONG
