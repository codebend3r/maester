/** SQL the media queries share, written once. Fragments assume `media m` and `libraries l`. */

/** `%`, `_` and `\` escaped, for a LIKE with `ESCAPE '\'`. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/** A LIKE pattern for text containing `search`; a search for "50%" matches the text "50%". */
export const likePattern = (search: string): string => `%${escapeLike(search)}%`

/** The best of a movie's files first: the most pixels, then the biggest file. */
export const BEST_FIRST = 'COALESCE(m.width * m.height, 0) DESC, m.size DESC, m.id'

/**
 * After a JOIN, gives `mi.item_id`: the file's first item, so a file holding
 * two episodes takes the first. Looked up for each file, by key: a grouped
 * subquery here was copied whole, every file's items, on each read, and
 * with statistics SQLite even drove sagas and duplicates from that copy
 * instead of from the library's files.
 */
export const FIRST_ITEM = `media_items mi
      ON mi.media_id = m.id
     AND mi.item_id = (SELECT MIN(z.item_id) FROM media_items z WHERE z.media_id = m.id)`

/** Joins `p.furthest`: the furthest any play of the file got. */
export const FURTHEST_JOIN = `
  LEFT JOIN (SELECT media_id, MAX(furthest) AS furthest FROM plays GROUP BY media_id) p
    ON p.media_id = m.id`

/**
 * Whether a play that got to `furthest` watched the file, by its library's
 * measure. A file whose length is still unknown is never watched.
 */
export const isWatched = (furthest: string): string =>
  `(m.duration > 0 AND ${furthest} >= m.duration * l.watched_percent / 100.0)`

/** An item's score: from the source its library shows, else TMDB's own. */
export const score = ({ item, source }: { item: string; source: string }): string =>
  `COALESCE((SELECT r.value FROM ratings r WHERE r.item_id = ${item} AND r.source = ${source}),
            (SELECT r.value FROM ratings r WHERE r.item_id = ${item} AND r.source = 'tmdb'))`
