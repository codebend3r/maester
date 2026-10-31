import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabase } from '@/test/database'
import { PRODUCTION_STATISTICS } from '@/test/queryPlans'

/**
 * Tables the copy has no statistics for, as `ANALYZE` gives an empty table
 * none: `ai_decisions` was empty on the real server, and `saga_backdrops`,
 * `person_credits`, `score_requests`, `bug_reports`, `media_markers`,
 * `media_fingerprints`, the music tables, the playlists, the album and
 * artist favourites, the lyrics cache, the similar artists and the
 * scrobbling tables came after the copy was taken.
 */
const NOT_IN_THE_COPY: ReadonlySet<string> = new Set([
  'ai_decisions',
  'saga_backdrops',
  'person_credits',
  'score_requests',
  'bug_reports',
  'media_markers',
  'media_fingerprints',
  'artists',
  'albums',
  'album_artists',
  'tracks',
  'track_artists',
  'playlists',
  'playlist_tracks',
  'album_favourites',
  'artist_favourites',
  'track_lyrics',
  'similar_artists',
  'scrobble_links',
  'scrobble_queue',
])

type KeyOfProps = { table: string; index: string | null }

/** A `sqlite_stat1` row's table and index, as one comparable key. */
const keyOf = ({ table, index }: KeyOfProps): string => `${table} ${index ?? '(no index)'}`

describe("the real server's statistics the plan tests copy", () => {
  const database = testDatabase('raven-statistics-copy-')

  beforeAll(() => database.open())
  afterAll(() => database.close())

  it('cover every index the schema has now, and every table with none', () => {
    const schema = database
      .get()
      .db.prepare<[], { tbl: string; idx: string | null }>(
        `WITH tables AS (
           SELECT name, wr FROM pragma_table_list
            WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'),
         indexes AS (
           SELECT t.name AS tbl, i.name AS idx
             FROM tables t
             JOIN sqlite_master i ON i.type = 'index' AND i.tbl_name = t.name
           UNION ALL
           SELECT name, name FROM tables WHERE wr = 1)
         SELECT tbl, idx FROM indexes
         UNION ALL
         SELECT name, NULL FROM tables WHERE name NOT IN (SELECT tbl FROM indexes)`,
      )
      .all()
      .filter(({ tbl }) => !NOT_IN_THE_COPY.has(tbl))
      .map(({ tbl, idx }) => keyOf({ table: tbl, index: idx }))

    expect(
      PRODUCTION_STATISTICS.map(([table, index]) => keyOf({ table, index })).toSorted(),
    ).toEqual(schema.toSorted())
  })
})
