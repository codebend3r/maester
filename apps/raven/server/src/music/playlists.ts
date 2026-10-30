import { Inject, Injectable } from '@nestjs/common'
import type { PlaylistDetails, PlaylistSummary } from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { MusicRepository } from '@/music/musicRepository'

type PlaylistRow = {
  id: number
  name: string
  created_at: string
  updated_at: string
  track_count: number
  duration: number
}

/** A playlist with its tracks counted and timed, those in a hidden library left out. */
const SELECT_PLAYLISTS = `SELECT p.id, p.name, p.created_at, p.updated_at,
                                 COUNT(m.id) AS track_count, COALESCE(SUM(m.duration), 0) AS duration
                            FROM playlists p
                            LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
                            LEFT JOIN media m ON m.id = pt.media_id
                                 AND m.library_id NOT IN (SELECT value FROM json_each(@hidden))
                           WHERE p.account_id = @account`

/** Which of a playlist's tracks a read takes: those the caller sees, or those in its hidden libraries. */
const ENTRY_SCOPES = { shown: 'NOT IN', hidden: 'IN' } as const

type EntryScope = (typeof ENTRY_SCOPES)[keyof typeof ENTRY_SCOPES]

/** A playlist's tracks in order, in or out of `@hidden`'s libraries as `scope` says. */
const selectEntries = (scope: EntryScope): string =>
  `SELECT pt.media_id FROM playlist_tracks pt
     JOIN playlists p ON p.id = pt.playlist_id AND p.account_id = @account
     JOIN media m ON m.id = pt.media_id
    WHERE pt.playlist_id = @id AND m.library_id ${scope} (SELECT value FROM json_each(@hidden))
    ORDER BY pt.position`

const toSummary = (row: PlaylistRow): PlaylistSummary => ({
  id: row.id,
  name: row.name,
  trackCount: row.track_count,
  duration: row.duration,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

type PlaylistsListProps = {
  account: AccountKey
  /** Libraries the caller may not see, whose tracks are left out. */
  hidden: readonly number[]
}

type PlaylistsGetProps = { id: number; account: AccountKey; hidden: readonly number[] }

type PlaylistsCreateProps = { name: string; account: AccountKey }

type PlaylistsRenameProps = { id: number; name: string; account: AccountKey }

type PlaylistsRemoveProps = { id: number; account: AccountKey }

type PlaylistsReplaceProps = {
  id: number
  mediaIds: readonly number[]
  account: AccountKey
  hidden: readonly number[]
}

type PlaylistsAppendProps = { id: number; mediaIds: readonly number[]; account: AccountKey }

type PlaylistsTouchProps = { id: number; account: AccountKey }

type PlaylistsInsertProps = {
  id: number
  mediaIds: readonly number[]
  from: number
  account: AccountKey
}

type PlaylistsEntriesProps = {
  id: number
  account: AccountKey
  hidden: readonly number[]
  scope: EntryScope
}

/**
 * Each account's playlists: a name and an order of tracks, by position, so
 * a track may come twice. Every statement names the account, so one
 * account's playlist is no other's to read or change; a playlist's tracks
 * are reached only through a playlist of the account's. A track in a
 * library the caller may not see is left out of what it reads and is kept
 * where it was when it changes the order.
 */
@Injectable()
export class Playlists {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MusicRepository) private readonly music: MusicRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /** The account's playlists, most recently changed first. */
  list({ account, hidden }: PlaylistsListProps): PlaylistSummary[] {
    return this.db
      .prepare<{ account: AccountKey; hidden: string }, PlaylistRow>(
        `${SELECT_PLAYLISTS} GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC`,
      )
      .all({ account, hidden: JSON.stringify(hidden) })
      .map(toSummary)
  }

  private entries({ id, account, hidden, scope }: PlaylistsEntriesProps): number[] {
    return this.db
      .prepare<{ id: number; account: AccountKey; hidden: string }, { media_id: number }>(
        selectEntries(scope),
      )
      .all({ id, account, hidden: JSON.stringify(hidden) })
      .map((row) => row.media_id)
  }

  /** The account's playlist with its tracks in order, or null when it has no such playlist. */
  get({ id, account, hidden }: PlaylistsGetProps): PlaylistDetails | null {
    const row = this.db
      .prepare<{ id: number; account: AccountKey; hidden: string }, PlaylistRow>(
        `${SELECT_PLAYLISTS} AND p.id = @id GROUP BY p.id`,
      )
      .get({ id, account, hidden: JSON.stringify(hidden) })
    if (!row) return null
    const ids = this.entries({ id, account, hidden, scope: ENTRY_SCOPES.shown })
    const tracks = this.music.tracks(ids)
    return {
      playlist: toSummary(row),
      tracks: ids.flatMap((mediaId) => tracks.get(mediaId) ?? []),
    }
  }

  /** Makes an empty playlist for the account; its id. */
  create({ name, account }: PlaylistsCreateProps): number {
    const at = new Date().toISOString()
    const inserted = this.db
      .prepare(
        `INSERT INTO playlists (account_id, name, created_at, updated_at)
         VALUES (@account, @name, @at, @at)`,
      )
      .run({ account, name, at })
    return Number(inserted.lastInsertRowid)
  }

  /** Renames the account's playlist; false when it has no such playlist. */
  rename({ id, name, account }: PlaylistsRenameProps): boolean {
    return (
      this.db
        .prepare(
          'UPDATE playlists SET name = @name, updated_at = @at WHERE id = @id AND account_id = @account',
        )
        .run({ id, name, account, at: new Date().toISOString() }).changes > 0
    )
  }

  /** Deletes the account's playlist and its order; false when it has no such playlist. */
  remove({ id, account }: PlaylistsRemoveProps): boolean {
    return (
      this.db
        .prepare('DELETE FROM playlists WHERE id = @id AND account_id = @account')
        .run({ id, account }).changes > 0
    )
  }

  /** Marks the account's playlist changed now; false when it has no such playlist. */
  private touch({ id, account }: PlaylistsTouchProps): boolean {
    return (
      this.db
        .prepare('UPDATE playlists SET updated_at = @at WHERE id = @id AND account_id = @account')
        .run({ id, account, at: new Date().toISOString() }).changes > 0
    )
  }

  /** Writes `mediaIds` from position `from` on, into the account's playlist `id`. */
  private insert({ id, mediaIds, from, account }: PlaylistsInsertProps): void {
    const insert = this.db.prepare<{
      id: number
      account: AccountKey
      position: number
      mediaId: number
    }>(
      `INSERT INTO playlist_tracks (playlist_id, position, media_id)
       SELECT id, @position, @mediaId FROM playlists WHERE id = @id AND account_id = @account`,
    )
    mediaIds.forEach((mediaId, at) => insert.run({ id, account, position: from + at, mediaId }))
  }

  /**
   * Puts `mediaIds` in place of the playlist's order. The tracks the caller
   * cannot see were never in the order it sent, so they follow it, in the
   * order they had, rather than being dropped. False when the account has no
   * such playlist.
   */
  replace({ id, mediaIds, account, hidden }: PlaylistsReplaceProps): boolean {
    return this.db.transaction(() => {
      const kept = this.entries({ id, account, hidden, scope: ENTRY_SCOPES.hidden })
      if (!this.touch({ id, account })) return false
      this.db
        .prepare(
          `DELETE FROM playlist_tracks
            WHERE playlist_id = (SELECT id FROM playlists WHERE id = @id AND account_id = @account)`,
        )
        .run({ id, account })
      this.insert({ id, mediaIds: [...mediaIds, ...kept], from: 0, account })
      return true
    })()
  }

  /** Adds `mediaIds` at the end of the playlist; false when the account has no such playlist. */
  append({ id, mediaIds, account }: PlaylistsAppendProps): boolean {
    return this.db.transaction(() => {
      if (!this.touch({ id, account })) return false
      const last =
        this.db
          .prepare<{ id: number; account: AccountKey }, { last: number | null }>(
            `SELECT MAX(pt.position) AS last FROM playlist_tracks pt
               JOIN playlists p ON p.id = pt.playlist_id AND p.account_id = @account
              WHERE pt.playlist_id = @id`,
          )
          .get({ id, account })?.last ?? -1
      this.insert({ id, mediaIds, from: last + 1, account })
      return true
    })()
  }
}
