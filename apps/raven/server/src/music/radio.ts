import { Inject, Injectable } from '@nestjs/common'
import { RADIO_SEED_KINDS, type RadioSeed, type Track, radioSeedText } from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import { DatabaseService } from '@/db/database'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { PLAY_KINDS } from '@/media/watchedRepository'
import { MIX_LIMITS } from '@/music/mixes'
import { dayShuffle, interleaved } from '@/music/mixOrder'
import { MusicRepository } from '@/music/musicRepository'
import { SimilarArtists } from '@/music/similarArtists'

/** A track played this recently is left out of a radio. */
const RESTING_MS = 24 * 60 * 60 * 1000

/** What a radio's seed came to: found, nothing by that id, or in a library the caller has not unlocked. */
export const RADIO_OUTCOMES = { found: 'found', missing: 'missing', locked: 'locked' } as const

export type RadioAnswer =
  | { outcome: typeof RADIO_OUTCOMES.found; tracks: Track[] }
  | { outcome: typeof RADIO_OUTCOMES.missing }
  | { outcome: typeof RADIO_OUTCOMES.locked }

type SeedLookup =
  | { outcome: typeof RADIO_OUTCOMES.found; artists: number[]; albums: number[] }
  | { outcome: typeof RADIO_OUTCOMES.missing }
  | { outcome: typeof RADIO_OUTCOMES.locked }

/** A track the caller sees, by `m`, that the account has not played in the last day. */
const CANDIDATE = `m.library_id NOT IN (SELECT value FROM json_each(@hidden))
                   AND NOT EXISTS (SELECT 1 FROM plays pl
                                    WHERE pl.account_id = @account AND pl.media_id = m.id
                                      AND pl.kind = @played AND pl.played_at >= @since)`

/** Tracks crediting any of `@artists`. */
const BY_ARTISTS = `SELECT DISTINCT ta.media_id AS id
                      FROM track_artists ta
                      JOIN media m ON m.id = ta.media_id
                     WHERE ta.artist_id IN (SELECT value FROM json_each(@artists)) AND ${CANDIDATE}
                     ORDER BY ta.media_id`

/** Tracks of an album that shares a genre with the seed's albums, `@albums`. */
const BY_GENRE = `SELECT t.media_id AS id
                    FROM tracks t
                    JOIN albums a ON a.id = t.album_id
                    JOIN media m ON m.id = t.media_id
                   WHERE EXISTS (SELECT 1 FROM json_each(a.genres) g
                                  WHERE g.value IN (SELECT DISTINCT seed.value
                                                      FROM albums sa, json_each(sa.genres) seed
                                                     WHERE sa.id IN (SELECT value FROM json_each(@albums))))
                     AND ${CANDIDATE}
                   ORDER BY t.media_id`

const ANY_TRACK = `SELECT t.media_id AS id FROM tracks t JOIN media m ON m.id = t.media_id
                    WHERE ${CANDIDATE} ORDER BY t.media_id`

type RadioScope = {
  account: AccountKey
  /** Libraries the caller may not see: their tracks are left out, and a seed in one is locked. */
  hidden: readonly number[]
}

type RadioPlayProps = { seed: RadioSeed } & RadioScope

type RadioLookupProps = { seed: RadioSeed; hidden: readonly number[] }

type RadioIdsProps = {
  sql: string
  scope: RadioScope
  now: number
  params?: Record<string, string>
}

/** The tiers a radio fills from, each dealt by a key of its own. */
const TIERS = { artist: 'artist', similar: 'similar', genre: 'genre', library: 'library' } as const

/**
 * How many tracks a radio takes of the seed's artists (a third) and of each
 * similar artist before the genre and the library, so it blends rather than
 * playing one artist's catalogue; more of them only fill what is left.
 */
const RADIO_CAPS = { seed: Math.ceil(MIX_LIMITS.tracks / 3), similar: 4 } as const

type DealProps = { ids: readonly number[]; tier: string }

type ByArtistsProps = { artists: readonly number[]; tier: string }

type OthersProps = { sql: string; tier: string; params?: Record<string, string> }

type RoundRobinProps = { groups: readonly (readonly number[])[] }

/** The first of each group, then the second of each, and so on. */
const roundRobin = ({ groups }: RoundRobinProps): number[] =>
  Array.from({ length: Math.max(0, ...groups.map((group) => group.length)) }, (_, at) =>
    groups.flatMap((group) => group[at] ?? []),
  ).flat()

/**
 * A radio around a track, an artist or an album: up to 50 tracks, first the
 * seed's artists', then those of the artists ListenBrainz finds similar
 * that the library holds, then the seed's genres, then anything, each tier
 * capped by `RADIO_CAPS`, leaving out what the account played in the last
 * day and the libraries it may not see, and spaced so no artist plays twice
 * in a row where that can be helped. Each tier is dealt by the day, so a
 * radio is the same all day, though a track played meanwhile drops out
 * and the rest move up.
 */
@Injectable()
export class Radio {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(SimilarArtists) private readonly similar: SimilarArtists,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db
  }

  /** The seed's artists and albums, or why there is no radio from it. */
  private lookup({ seed, hidden }: RadioLookupProps): SeedLookup {
    const isHidden = (libraryId: number): boolean => hidden.includes(libraryId)
    switch (seed.kind) {
      case RADIO_SEED_KINDS.track: {
        const track = this.music.tracks([seed.id]).get(seed.id)
        if (track === undefined) return { outcome: RADIO_OUTCOMES.missing }
        if (isHidden(track.libraryId)) return { outcome: RADIO_OUTCOMES.locked }
        return {
          outcome: RADIO_OUTCOMES.found,
          artists: track.artists.map(({ id }) => id),
          albums: [track.albumId],
        }
      }
      case RADIO_SEED_KINDS.album: {
        const libraryId = this.music.libraryOfAlbum(seed.id)
        if (libraryId === null) return { outcome: RADIO_OUTCOMES.missing }
        if (isHidden(libraryId)) return { outcome: RADIO_OUTCOMES.locked }
        const artists = this.db
          .prepare<[number], { id: number }>(
            'SELECT artist_id AS id FROM album_artists WHERE album_id = ? ORDER BY position',
          )
          .all(seed.id)
          .map(({ id }) => id)
        return { outcome: RADIO_OUTCOMES.found, artists, albums: [seed.id] }
      }
      case RADIO_SEED_KINDS.artist: {
        const libraries = this.db
          .prepare<[number], { album_id: number; library_id: number }>(
            `SELECT DISTINCT t.album_id, m.library_id
               FROM track_artists ta
               JOIN tracks t ON t.media_id = ta.media_id
               JOIN media m ON m.id = ta.media_id
              WHERE ta.artist_id = ?`,
          )
          .all(seed.id)
        if (libraries.length === 0) return { outcome: RADIO_OUTCOMES.missing }
        const seen = libraries.filter((row) => !isHidden(row.library_id))
        if (seen.length === 0) return { outcome: RADIO_OUTCOMES.locked }
        return {
          outcome: RADIO_OUTCOMES.found,
          artists: [seed.id],
          albums: [...new Set(seen.map((row) => row.album_id))],
        }
      }
      default: {
        const unknown: never = seed.kind
        return unknown
      }
    }
  }

  private ids({ sql, scope, now, params = {} }: RadioIdsProps): number[] {
    return this.db
      .prepare<Record<string, string>, { id: number }>(sql)
      .all({
        account: scope.account,
        hidden: JSON.stringify(scope.hidden),
        played: PLAY_KINDS.played,
        since: new Date(now - RESTING_MS).toISOString(),
        ...params,
      })
      .map((row) => row.id)
  }

  /** The radio from `seed`, or why there is none. */
  async play({ seed, ...scope }: RadioPlayProps): Promise<RadioAnswer> {
    const found = this.lookup({ seed, hidden: scope.hidden })
    if (found.outcome !== RADIO_OUTCOMES.found) return found
    const now = this.clock.now()
    const deal = ({ ids, tier }: DealProps): number[] =>
      dayShuffle({ items: ids, now, key: `${radioSeedText(seed)}:${tier}` })
    const similarArtists = (
      await Promise.all(found.artists.map((artistId) => this.similar.of({ artistId })))
    )
      .flat()
      .filter((id, at, all) => !found.artists.includes(id) && all.indexOf(id) === at)
    const byArtists = ({ artists, tier }: ByArtistsProps): number[] =>
      deal({
        ids: this.ids({
          sql: BY_ARTISTS,
          scope,
          now,
          params: { artists: JSON.stringify(artists) },
        }),
        tier,
      })
    const seeds = byArtists({ artists: found.artists, tier: TIERS.artist })
    const similars = similarArtists.map((artistId) =>
      byArtists({ artists: [artistId], tier: `${TIERS.similar}:${artistId}` }),
    )
    // The genre and the library leave the seed's and the similar artists' tracks to their own tiers and caps.
    const kept = new Set([...seeds, ...similars.flat()])
    const others =
      ({ sql, tier, params }: OthersProps): (() => number[]) =>
      () =>
        deal({ ids: this.ids({ sql, scope, now, params }), tier }).filter((id) => !kept.has(id))
    const tiers: (() => number[])[] = [
      () => seeds.slice(0, RADIO_CAPS.seed),
      () => roundRobin({ groups: similars.map((group) => group.slice(0, RADIO_CAPS.similar)) }),
      others({
        sql: BY_GENRE,
        tier: TIERS.genre,
        params: { albums: JSON.stringify(found.albums) },
      }),
      others({ sql: ANY_TRACK, tier: TIERS.library }),
      // A library too small to fill the radio otherwise takes more of the seed's and the similar artists'.
      () => seeds.slice(RADIO_CAPS.seed),
      () => roundRobin({ groups: similars.map((group) => group.slice(RADIO_CAPS.similar)) }),
    ]
    const ids = tiers.reduce<number[]>((picked, tier) => {
      if (picked.length >= MIX_LIMITS.tracks) return picked
      const taken = new Set(picked)
      return [...picked, ...new Set(tier().filter((id) => !taken.has(id)))].slice(
        0,
        MIX_LIMITS.tracks,
      )
    }, [])
    const byId = this.music.tracks(ids)
    return {
      outcome: RADIO_OUTCOMES.found,
      tracks: interleaved({ tracks: ids.flatMap((id) => byId.get(id) ?? []) }),
    }
  }
}
