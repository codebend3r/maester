import { type ArtistCredit, isArtistCredit, listOf, sortTitle } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { parseJsonAs } from '@/db/json'
import { type NamedArtist, nameKeyOf } from '@/music/filing'

const isArtistCredits = listOf(isArtistCredit)

/** The credit tables, each keyed by what it credits. */
export const CREDITS = {
  album: { table: 'album_artists', owner: 'album_id' },
  track: { table: 'track_artists', owner: 'media_id' },
} as const

/** The artists a credit list's JSON names, or none when it is not what the queries write. */
export const creditsOf = (json: string): ArtistCredit[] =>
  parseJsonAs({ json, guard: isArtistCredits }) ?? []

type ArtistIdProps = NamedArtist & { db: Sqlite.Database }

/** The artist's row, found by id, else by name; made when there is none. An id learnt later is kept. */
const artistId = ({ db, name, mbid }: ArtistIdProps): number => {
  const byMbid =
    mbid === null
      ? undefined
      : db.prepare<[string], { id: number }>('SELECT id FROM artists WHERE mbid = ?').get(mbid)
  if (byMbid) return byMbid.id
  const nameKey = nameKeyOf(name)
  const byName = db
    .prepare<[string], { id: number; mbid: string | null }>(
      'SELECT id, mbid FROM artists WHERE name_key = ?',
    )
    .get(nameKey)
  if (byName) {
    if (mbid !== null && byName.mbid === null) {
      db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(mbid, byName.id)
    }
    return byName.id
  }
  const inserted = db
    .prepare('INSERT INTO artists (name, sort_name, name_key, mbid) VALUES (?, ?, ?, ?)')
    .run(name, sortTitle(name), nameKey, mbid)
  return Number(inserted.lastInsertRowid)
}

type CreditArtistsProps = {
  db: Sqlite.Database
  credits: (typeof CREDITS)[keyof typeof CREDITS]
  ownerId: number
  artists: readonly NamedArtist[]
}

/** Credits `artists` on an album or a track in their order, in place of whoever was credited before; the same artist named twice is credited once. */
export const creditArtists = ({ db, credits, ownerId, artists }: CreditArtistsProps): void => {
  db.prepare(`DELETE FROM ${credits.table} WHERE ${credits.owner} = ?`).run(ownerId)
  const insert = db.prepare(
    `INSERT INTO ${credits.table} (${credits.owner}, artist_id, position) VALUES (?, ?, ?)`,
  )
  const distinct = [...new Set(artists.map((artist) => artistId({ db, ...artist })))]
  distinct.forEach((id, position) => insert.run(ownerId, id, position))
}
