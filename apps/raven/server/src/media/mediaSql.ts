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

/**
 * Whether the file `file` is watched: it has a `marked` play, or a `played`
 * one that got to its library's watched percentage. A file whose length is
 * still unknown is watched only by a mark. An `EXISTS` over the file's
 * plays, by `plays_media`, so it never aggregates the whole table. Assumes
 * `libraries l` is its library.
 */
export const fileWatched = (file: string): string =>
  `EXISTS (SELECT 1 FROM plays pl
            WHERE pl.media_id = ${file}.id
              AND (pl.kind = 'marked'
                   OR (pl.kind = 'played' AND ${file}.duration > 0
                       AND pl.furthest >= ${file}.duration * l.watched_percent / 100.0)))`

/**
 * Whether the card of the file `file` is watched, `item` being its first
 * item: any file in its library with the same item and `split`, or the file
 * alone when nothing is matched to it. The CROSS JOIN starts the walk from
 * the item's files, as the version count does.
 */
export const cardWatched = ({ file, item }: { file: string; item: string }): string =>
  `CASE WHEN ${item}.id IS NULL THEN ${fileWatched(file)}
        ELSE EXISTS (SELECT 1 FROM media_items x CROSS JOIN media y ON y.id = x.media_id
                      WHERE x.item_id = ${item}.id AND y.library_id = ${file}.library_id
                        AND y.split IS ${file}.split AND ${fileWatched('y')})
   END`

/** An item's score: from the source its library shows, else TMDB's own. */
export const score = ({ item, source }: { item: string; source: string }): string =>
  `COALESCE((SELECT r.value FROM ratings r WHERE r.item_id = ${item} AND r.source = ${source}),
            (SELECT r.value FROM ratings r WHERE r.item_id = ${item} AND r.source = 'tmdb'))`
