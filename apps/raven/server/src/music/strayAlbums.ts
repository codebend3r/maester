import { dirname } from 'node:path'
import { MATCH_STATES } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { isSamePlainTitle } from '@/music/albumTitles'
import { albumFolderOf } from '@/music/filing'
import { artistKeysOf, foldInto, parseNames } from '@/music/similarAlbums'

/** The most tracks a stray in a folder beside its album may hold: a bonus track or two, never a disc. */
const STRAY_TRACKS_MOST = 3

type FoldStrayAlbumsProps = { db: Sqlite.Database; libraryId: number }

/** One unmatched album folded into the album its tracks belong to. */
export type StrayFold = { from: string; into: string; tracks: number }

type StrayRow = {
  id: number
  title: string
  match: string
  tracks: number
  path: string
  artists: string | null
}

/** An album as folding reads it: a stray to fold, or a keeper to fold one into. */
type FoldableAlbum = {
  id: number
  title: string
  isUnmatched: boolean
  tracks: number
  folder: string
  artistKeys: Set<string>
}

type BelongsProps = {
  stray: FoldableAlbum
  album: FoldableAlbum
  /** How many tracks the album holds now, the strays folded into it so far included. */
  holds: number
}

/** Two albums of one folder are one album, the folder being what makes an album. */
const isSameFolder = ({ stray, album }: BelongsProps): boolean => stray.folder === album.folder

/**
 * A few tracks in a folder beside an album's, under the same title and an
 * artist in common, are that album's: a bonus track filed in a folder of its own.
 */
const isBesideIt = ({ stray, album, holds }: BelongsProps): boolean =>
  dirname(stray.folder) === dirname(album.folder) &&
  stray.tracks <= STRAY_TRACKS_MOST &&
  stray.tracks < holds &&
  isSamePlainTitle({ a: stray.title, b: album.title }) &&
  [...stray.artistKeys].some((key) => album.artistKeys.has(key))

const belongs = (props: BelongsProps): boolean => isSameFolder(props) || isBesideIt(props)

type FoldsSoFar = {
  /** The strays folded away already. */
  gone: Set<number>
  /** How many tracks each keeper gained from the strays folded into it. */
  grown: Map<number, number>
  folds: StrayFold[]
}

/**
 * Folds each unmatched album whose tracks belong to another album by where
 * they sit into that album, the one with the most tracks when several fit:
 * one sharing its folder (a disc folder raven split off), or one in the
 * folder beside it with the same title. An album the owner matched by hand
 * is never touched. What was folded, smallest first.
 */
export const foldStrayAlbums = ({ db, libraryId }: FoldStrayAlbumsProps): StrayFold[] =>
  db.transaction(() => {
    const albums = db
      .prepare<[number, string], StrayRow>(
        `SELECT a.id, a.title, a.match, COUNT(t.media_id) AS tracks, MIN(m.path) AS path,
                (SELECT json_group_array(ar.name) FROM album_artists aa
                   JOIN artists ar ON ar.id = aa.artist_id WHERE aa.album_id = a.id) AS artists
           FROM albums a JOIN tracks t ON t.album_id = a.id JOIN media m ON m.id = t.media_id
          WHERE a.library_id = ? AND a.match <> ? GROUP BY a.id`,
      )
      .all(libraryId, MATCH_STATES.manual)
      .map((row): FoldableAlbum => ({
        id: row.id,
        title: row.title,
        isUnmatched: row.match === MATCH_STATES.unmatched,
        tracks: row.tracks,
        folder: albumFolderOf(row.path),
        artistKeys: artistKeysOf({ names: parseNames(row.artists) }),
      }))
      .toSorted((a, b) => a.tracks - b.tracks || a.id - b.id)
    return albums
      .filter((album) => album.isUnmatched)
      .reduce<FoldsSoFar>(
        ({ gone, grown, folds }, stray) => {
          // A keeper holds the strays folded into it so far, so a later stray is measured against them too.
          const holds = (album: FoldableAlbum): number => album.tracks + (grown.get(album.id) ?? 0)
          const [keeper] = albums
            .filter(
              (album) =>
                album.id !== stray.id &&
                !gone.has(album.id) &&
                belongs({ stray, album, holds: holds(album) }),
            )
            .toSorted((a, b) => holds(b) - holds(a) || a.id - b.id)
          if (!keeper) return { gone, grown, folds }
          foldInto({ db, keeper: keeper.id, other: stray.id })
          // A stray that kept others first moves their tracks along with its own.
          const tracks = holds(stray)
          return {
            gone: new Set([...gone, stray.id]),
            grown: new Map([...grown, [keeper.id, (grown.get(keeper.id) ?? 0) + tracks]]),
            folds: [...folds, { from: stray.title, into: keeper.title, tracks }],
          }
        },
        { gone: new Set(), grown: new Map(), folds: [] },
      ).folds
  })()
