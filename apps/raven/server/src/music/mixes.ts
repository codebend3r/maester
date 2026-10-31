import { Inject, Injectable } from '@nestjs/common'
import {
  MIX_KINDS,
  type MixDetails,
  type MixKind,
  type MixSummary,
  type RecentAlbums,
  type Track,
} from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import { DatabaseService } from '@/db/database'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { PLAY_KINDS } from '@/media/watchedRepository'
import { dayShuffle, interleaved, utcDayOf } from '@/music/mixOrder'
import { MusicRepository } from '@/music/musicRepository'

const DAY_MS = 24 * 60 * 60 * 1000

/** How many tracks a mix holds at most, the fewest it is listed with, and how many albums Home's rows show. */
export const MIX_LIMITS = { tracks: 50, fewest: 10, recent: 20, covers: 4 } as const

/** How far back heavy rotation and recently added look, and how long rediscover waits. */
const WINDOWS_MS = { rotation: 30 * DAY_MS, added: 30 * DAY_MS, rediscover: 90 * DAY_MS } as const

/** Heavy rotation always keeps this many of its most played; the rest of it is dealt by the day. */
const ROTATION_CORE = 25

/** Rediscover takes a track played at least this often. */
const REDISCOVER_PLAYS = 3

/** A track in a library the caller sees, the only kind a mix or Home holds. */
const SEEN = 'm.library_id NOT IN (SELECT value FROM json_each(@hidden))'

/**
 * The account's listens of tracks it sees: its own `played` rows, by its
 * key. On a server with one account its key picks out every play, and the
 * planner would rather read them all; `INDEXED BY` keeps every read to the
 * account's own.
 */
const LISTENS = `FROM plays pl INDEXED BY plays_account
                 JOIN tracks t ON t.media_id = pl.media_id
                 JOIN media m ON m.id = pl.media_id
                WHERE pl.account_id = @account AND pl.kind = @played AND ${SEEN}`

/** Heavy rotation's most played in its window, most first. */
const MOST_PLAYED = `SELECT pl.media_id AS id ${LISTENS} AND pl.played_at >= @since
                      GROUP BY pl.media_id
                      ORDER BY COUNT(*) DESC, MAX(pl.played_at) DESC, pl.media_id
                      LIMIT ${MIX_LIMITS.tracks}`

/** The tracks the account never played by the artists of `@ids`. */
const UNPLAYED_BY = `SELECT DISTINCT ta.media_id AS id
                       FROM track_artists ta
                       JOIN media m ON m.id = ta.media_id
                      WHERE ta.artist_id IN (SELECT artist_id FROM track_artists
                                              WHERE media_id IN (SELECT value FROM json_each(@ids)))
                        AND ${SEEN}
                        AND NOT EXISTS (SELECT 1 FROM plays pl
                                         WHERE pl.account_id = @account AND pl.media_id = ta.media_id
                                           AND pl.kind = @played)
                      ORDER BY ta.media_id`

const REDISCOVER = `SELECT pl.media_id AS id ${LISTENS}
                     GROUP BY pl.media_id
                    HAVING COUNT(*) >= ${REDISCOVER_PLAYS} AND MAX(pl.played_at) < @since
                     ORDER BY pl.media_id`

/** Played on `@monthDay` (`MM-DD`) of a year before `@yearStart`'s. */
const ON_THIS_DAY = `SELECT DISTINCT pl.media_id AS id ${LISTENS}
                       AND substr(pl.played_at, 6, 5) = @monthDay AND pl.played_at < @yearStart
                     ORDER BY pl.media_id`

const RECENTLY_ADDED = `SELECT t.media_id AS id
                          FROM albums a
                          JOIN tracks t ON t.album_id = a.id
                          JOIN media m ON m.id = t.media_id
                         WHERE a.added_at >= @since AND ${SEEN}
                         ORDER BY t.media_id`

const PLAYED_ALBUMS = `SELECT t.album_id AS id ${LISTENS}
                        GROUP BY t.album_id
                        ORDER BY MAX(pl.played_at) DESC, t.album_id DESC
                        LIMIT ${MIX_LIMITS.recent}`

const ADDED_ALBUMS = `SELECT a.id FROM albums a
                       WHERE a.library_id NOT IN (SELECT value FROM json_each(@hidden))
                       ORDER BY a.added_at DESC, a.id DESC
                       LIMIT ${MIX_LIMITS.recent}`

type MixesScope = {
  account: AccountKey
  /** Libraries the caller may not see, whose tracks no mix holds. */
  hidden: readonly number[]
}

type MixesGetProps = { kind: MixKind } & MixesScope

type MixesIdsProps = { sql: string; scope: MixesScope; params?: Record<string, string | number> }

type MixesPicksProps = { kind: MixKind; scope: MixesScope; now: number }

type SummaryOfProps = { kind: MixKind; tracks: readonly Track[] }

const summaryOf = ({ kind, tracks }: SummaryOfProps): MixSummary => ({
  id: kind,
  trackCount: tracks.length,
  duration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
  covers: tracks
    .flatMap(({ albumId, album }) =>
      album.coverVersion === null ? [] : [{ albumId, coverVersion: album.coverVersion }],
    )
    .filter((cover, at, all) => all.findIndex((each) => each.albumId === cover.albumId) === at)
    .slice(0, MIX_LIMITS.covers),
})

/**
 * The account's mixes, one of each kind in `MIX_KINDS`, made from its own
 * plays and the libraries it sees, and Home's recent albums. A mix is the
 * same all day (UTC), dealt again the next, and one with fewer than
 * `MIX_LIMITS.fewest` tracks is left out.
 */
@Injectable()
export class Mixes {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private ids({ sql, scope, params = {} }: MixesIdsProps): number[] {
    return this.database.db
      .prepare<Record<string, string | number>, { id: number }>(sql)
      .all({
        account: scope.account,
        hidden: JSON.stringify(scope.hidden),
        played: PLAY_KINDS.played,
        ...params,
      })
      .map((row) => row.id)
  }

  /** The media ids `kind` holds today, in no order yet. */
  private picks({ kind, scope, now }: MixesPicksProps): number[] {
    const since = (ms: number): string => new Date(now - ms).toISOString()
    const dealt = (ids: readonly number[]): number[] =>
      dayShuffle({ items: ids, now, key: kind }).slice(0, MIX_LIMITS.tracks)
    switch (kind) {
      case MIX_KINDS.heavyRotation: {
        const most = this.ids({
          sql: MOST_PLAYED,
          scope,
          params: { since: since(WINDOWS_MS.rotation) },
        })
        const unplayed = this.ids({
          sql: UNPLAYED_BY,
          scope,
          params: { ids: JSON.stringify(most) },
        })
        return [
          ...most.slice(0, ROTATION_CORE),
          ...dealt([...unplayed, ...most.slice(ROTATION_CORE)]),
        ].slice(0, MIX_LIMITS.tracks)
      }
      case MIX_KINDS.rediscover:
        return dealt(
          this.ids({ sql: REDISCOVER, scope, params: { since: since(WINDOWS_MS.rediscover) } }),
        )
      case MIX_KINDS.onThisDay: {
        const day = utcDayOf(now)
        return dealt(
          this.ids({
            sql: ON_THIS_DAY,
            scope,
            params: { monthDay: day.slice(5), yearStart: `${day.slice(0, 4)}-01-01` },
          }),
        )
      }
      case MIX_KINDS.recentlyAdded:
        return dealt(
          this.ids({ sql: RECENTLY_ADDED, scope, params: { since: since(WINDOWS_MS.added) } }),
        )
      default: {
        const unknown: never = kind
        return unknown
      }
    }
  }

  /** The mix of `kind` with its tracks in today's order, or null when it holds too few. */
  get({ kind, ...scope }: MixesGetProps): MixDetails | null {
    const now = this.clock.now()
    const ids = this.picks({ kind, scope, now })
    if (ids.length < MIX_LIMITS.fewest) return null
    const byId = this.music.tracks(ids)
    const tracks = interleaved({
      tracks: dayShuffle({ items: ids.flatMap((id) => byId.get(id) ?? []), now, key: kind }),
    })
    return { mix: summaryOf({ kind, tracks }), tracks }
  }

  /** Today's mixes in `MIX_KINDS` order, those with too few tracks left out. */
  list(scope: MixesScope): MixSummary[] {
    return Object.values(MIX_KINDS).flatMap((kind) => this.get({ kind, ...scope })?.mix ?? [])
  }

  /** The albums the account played last, and those added last, each in a library it sees. */
  recent(scope: MixesScope): RecentAlbums {
    const albumsOf = (ids: readonly number[]) => {
      const albums = this.music.albums(ids)
      return ids.flatMap((id) => albums.get(id) ?? [])
    }
    return {
      played: albumsOf(this.ids({ sql: PLAYED_ALBUMS, scope })),
      added: albumsOf(this.ids({ sql: ADDED_ALBUMS, scope })),
    }
  }
}
