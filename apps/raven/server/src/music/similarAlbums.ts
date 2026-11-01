import { MATCH_STATES, foldTitle } from '@raven/core'
import type Sqlite from 'better-sqlite3'

type MergeSimilarAlbumsProps = { db: Sqlite.Database; libraryId: number }

type AlbumRow = {
  id: number
  title: string
  year: number | null
  mbid: string | null
  added_at: string
  cover_source: string | null
  tracks: number
  artists: string | null
}

type Candidate = {
  id: number
  title: string
  mbid: string | null
  addedAt: string
  hasCover: boolean
  tracks: number
  artistKeys: Set<string>
  group: string
}

const ARTIST_SEPARATOR =
  /\s*(?:&|,|;|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\band\b|\bwith\b|\bx\b)\s*/i

type ArtistKeysOfProps = { names: readonly string[] }

/** Each artist named in a credit, folded: "2 Chainz & Lil Wayne" names two. */
const artistKeysOf = ({ names }: ArtistKeysOfProps): Set<string> =>
  new Set(
    names
      .flatMap((name) => name.split(ARTIST_SEPARATOR))
      .map(foldTitle)
      .filter((key) => key !== ''),
  )

type SharesProps = { a: Candidate; b: Candidate }

/**
 * Whether two albums of one title and year are one release: they carry the
 * same MusicBrainz release, or they hold as many tracks and credit an artist
 * in common, as a release filed under "2 Chainz" and "2 Chainz & Lil Wayne" does.
 */
const isSameRelease = ({ a, b }: SharesProps): boolean => {
  if (a.mbid !== null && a.mbid === b.mbid) return true
  return a.tracks === b.tracks && [...a.artistKeys].some((key) => b.artistKeys.has(key))
}

type ClusterProps = { candidates: readonly Candidate[] }

/** The albums grouped into releases: any two that are the same release, however they chain, share one. */
const clustersOf = ({ candidates }: ClusterProps): Candidate[][] => {
  const parent = new Map(candidates.map((candidate) => [candidate.id, candidate.id]))
  const rootOf = (id: number): number => {
    const up = parent.get(id) ?? id
    return up === id ? id : rootOf(up)
  }
  candidates.forEach((a, at) =>
    candidates.slice(at + 1).forEach((b) => {
      if (a.group === b.group && isSameRelease({ a, b })) parent.set(rootOf(b.id), rootOf(a.id))
    }),
  )
  const clusters = candidates.reduce((found, candidate) => {
    const root = rootOf(candidate.id)
    found.set(root, [...(found.get(root) ?? []), candidate])
    return found
  }, new Map<number, Candidate[]>())
  return [...clusters.values()].filter((cluster) => cluster.length > 1)
}

/** The album the others fold into: one with a release id, then one with a cover, then the oldest. */
const byKeeping = (a: Candidate, b: Candidate): number =>
  Number(b.mbid !== null) - Number(a.mbid !== null) ||
  Number(b.hasCover) - Number(a.hasCover) ||
  a.addedAt.localeCompare(b.addedAt) ||
  a.id - b.id

/**
 * Looks through a music library and folds every album that is the same
 * release as another into one: same title and year, and the same MusicBrainz
 * release or the same track count under an artist in common. Tracks, favourites
 * and what the keeper lacks move over; the albums left empty go. An album the
 * owner matched by hand is never touched. How many albums went.
 */
export const mergeSimilarAlbums = ({ db, libraryId }: MergeSimilarAlbumsProps): number =>
  db.transaction(() => {
    const rows = db
      .prepare<[number, string], AlbumRow>(
        `SELECT a.id, a.title, a.year, a.mbid, a.added_at, a.cover_source,
                (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id) AS tracks,
                (SELECT json_group_array(ar.name) FROM album_artists aa
                   JOIN artists ar ON ar.id = aa.artist_id WHERE aa.album_id = a.id) AS artists
           FROM albums a WHERE a.library_id = ? AND a.match <> ?`,
      )
      .all(libraryId, MATCH_STATES.manual)
    const candidates = rows.map((row): Candidate => ({
      id: row.id,
      title: row.title,
      mbid: row.mbid,
      addedAt: row.added_at,
      hasCover: row.cover_source !== null,
      tracks: row.tracks,
      artistKeys: artistKeysOf({ names: parseNames(row.artists) }),
      group: JSON.stringify([foldTitle(row.title), row.year]),
    }))
    const clusters = clustersOf({ candidates })
    clusters.forEach((cluster) => {
      const [keeper, ...others] = cluster.toSorted(byKeeping)
      if (!keeper) return
      others.forEach((other) => foldInto({ db, keeper: keeper.id, other: other.id }))
    })
    return clusters.reduce((count, cluster) => count + cluster.length - 1, 0)
  })()

type ParseNamesProps = string | null

const parseNames = (json: ParseNamesProps): string[] => {
  const parsed: unknown = json === null ? [] : JSON.parse(json)
  return Array.isArray(parsed)
    ? parsed.filter((name): name is string => typeof name === 'string')
    : []
}

type FoldIntoProps = { db: Sqlite.Database; keeper: number; other: number }

const foldInto = ({ db, keeper, other }: FoldIntoProps): void => {
  db.prepare('UPDATE tracks SET album_id = ? WHERE album_id = ?').run(keeper, other)
  db.prepare(
    `UPDATE albums SET
       year = COALESCE(year, (SELECT year FROM albums WHERE id = @other)),
       original_year = COALESCE(original_year, (SELECT original_year FROM albums WHERE id = @other)),
       release_date = COALESCE(release_date, (SELECT release_date FROM albums WHERE id = @other)),
       label = COALESCE(label, (SELECT label FROM albums WHERE id = @other)),
       added_at = MIN(added_at, (SELECT added_at FROM albums WHERE id = @other))
     WHERE id = @keeper`,
  ).run({ keeper, other })
  db.prepare(
    `UPDATE albums SET (cover_source, cover_ref, cover_stamp) =
       (SELECT cover_source, cover_ref, cover_stamp FROM albums WHERE id = @other)
     WHERE id = @keeper AND cover_source IS NULL AND EXISTS (
       SELECT 1 FROM albums peer WHERE peer.id = @other AND peer.cover_source IN ('file', 'embedded'))`,
  ).run({ keeper, other })
  db.prepare(
    `INSERT INTO album_favourites (account_id, album_id, added_at)
     SELECT account_id, @keeper, added_at FROM album_favourites WHERE album_id = @other
     ON CONFLICT (account_id, album_id) DO UPDATE SET added_at = MIN(added_at, excluded.added_at)`,
  ).run({ keeper, other })
  db.prepare('DELETE FROM albums WHERE id = ?').run(other)
}
