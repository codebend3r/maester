import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/clock'
import { DatabaseService } from '@/db/database'
import {
  LISTENBRAINZ_AWAY_MS,
  ListenBrainzClient,
  type SimilarArtist,
} from '@/music/listenBrainzClient'
import { createOnce } from '@/once'

/** How long what ListenBrainz said of an artist is kept before it is asked again. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

/** How many artists the memo of answers no row records holds, the oldest going first. */
const MEMO_LIMIT = 1024

type SimilarArtistsOfProps = { artistId: number }

type SimilarArtistsSaveProps = { artistId: number; similar: readonly SimilarArtist[] }

type SimilarArtistsRememberProps = { artistId: number; forMs: number }

/**
 * The artists the library holds that ListenBrainz finds similar to one of
 * ours, closest first, through the `similar_artists` cache. An artist with
 * no MusicBrainz id has none. While ListenBrainz is away nothing is asked;
 * a failure or an empty answer is remembered per artist, so it is not asked
 * again soon either. What was kept is read all the same, or nothing; a radio
 * goes on without them either way.
 */
@Injectable()
export class SimilarArtists {
  private readonly asking = createOnce<void>()
  /** Until when each artist is not asked again: its answer was empty, which no row records, or failed. */
  private readonly memo = new Map<number, number>()

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ListenBrainzClient) private readonly listenBrainz: ListenBrainzClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db
  }

  /** The library's artists similar to `artistId`, closest first. */
  async of({ artistId }: SimilarArtistsOfProps): Promise<number[]> {
    const mbid =
      this.db
        .prepare<[number], { mbid: string | null }>('SELECT mbid FROM artists WHERE id = ?')
        .get(artistId)?.mbid ?? null
    if (mbid === null) return []
    if (!this.listenBrainz.isAway && !this.isFresh({ artistId })) {
      await this.asking.run({
        key: String(artistId),
        make: () =>
          this.listenBrainz.similarArtists(mbid).then(
            (similar) => this.save({ artistId, similar }),
            () => this.remember({ artistId, forMs: LISTENBRAINZ_AWAY_MS }),
          ),
      })
    }
    return this.db
      .prepare<[number], { id: number }>(
        `SELECT ar.id FROM similar_artists s
           JOIN artists ar ON ar.mbid = s.similar_id
          WHERE s.artist_id = ?
          ORDER BY s.score DESC, ar.id`,
      )
      .all(artistId)
      .map((row) => row.id)
  }

  private isFresh({ artistId }: SimilarArtistsOfProps): boolean {
    if ((this.memo.get(artistId) ?? -Infinity) > this.clock.now()) return true
    const since = this.clock.now() - KEEP_MS
    const fetchedAt =
      this.db
        .prepare<[number], { fetched_at: string | null }>(
          'SELECT MAX(fetched_at) AS fetched_at FROM similar_artists WHERE artist_id = ?',
        )
        .get(artistId)?.fetched_at ?? null
    return fetchedAt !== null && Date.parse(fetchedAt) >= since
  }

  private remember({ artistId, forMs }: SimilarArtistsRememberProps): void {
    this.memo.delete(artistId)
    this.memo.set(artistId, this.clock.now() + forMs)
    const [oldest] = this.memo.keys()
    if (this.memo.size > MEMO_LIMIT && oldest !== undefined) this.memo.delete(oldest)
  }

  private save({ artistId, similar }: SimilarArtistsSaveProps): void {
    const at = this.clock.now()
    if (similar.length === 0) this.remember({ artistId, forMs: KEEP_MS })
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM similar_artists WHERE artist_id = ?').run(artistId)
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO similar_artists (artist_id, similar_id, score, fetched_at)
         VALUES (?, ?, ?, ?)`,
      )
      similar.forEach(({ mbid, score }) =>
        insert.run(artistId, mbid, score, new Date(at).toISOString()),
      )
    })()
  }
}
