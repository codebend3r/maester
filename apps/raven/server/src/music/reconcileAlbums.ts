import { Logger } from '@nestjs/common'
import { MATCH_STATES } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { albumFolderOf, discOfPath } from '@/music/filing'

type ReconcileAlbumsProps = { db: Sqlite.Database }
type FiledTrack = {
  media_id: number
  album_id: number
  library_id: number
  path: string
  disc: number
}
type Album = { id: number; album_key: string; match: string; mbid: string | null; added_at: string }

const COPIED_COLUMNS = `title, sort_title, year, original_year, mbid, release_group_mbid, type,
  label, genres, is_compilation, credited_by_tags, cover_source, cover_ref, replaygain_gain,
  replaygain_peak, added_at, match, match_confidence, matched_at, release_date, metadata_path, cover_stamp`

/** Repairs identities without recreating media, playlists, credits or per-account viewing data. */
export const reconcileAlbums = ({ db }: ReconcileAlbumsProps): void => {
  const logger = new Logger('AlbumFolders')
  db.transaction(() => {
    const tracks = db
      .prepare<[], FiledTrack>(
        `SELECT t.media_id, t.album_id, m.library_id, m.path, t.disc
         FROM tracks t JOIN media m ON m.id = t.media_id ORDER BY m.path, m.id`,
      )
      .all()
    const groups = tracks.reduce((found, track) => {
      const key = JSON.stringify([track.library_id, albumFolderOf(track.path)])
      found.set(key, [...(found.get(key) ?? []), track])
      return found
    }, new Map<string, FiledTrack[]>())
    const used = new Set<number>()
    groups.forEach((files) => {
      const first = files[0]
      if (!first) return
      const key = `folder:${albumFolderOf(first.path)}`
      const ids = [...new Set(files.map((file) => file.album_id))]
      const albums = db
        .prepare<[string], Album>(
          `SELECT id, album_key, match, mbid, added_at FROM albums
          WHERE id IN (SELECT value FROM json_each(?))
          ORDER BY CASE WHEN match = 'manual' THEN 0 ELSE 1 END, added_at, id`,
        )
        .all(JSON.stringify(ids))
      const manual = albums.filter((album) => album.match === MATCH_STATES.manual)
      if (new Set(manual.map((album) => album.mbid)).size > 1) {
        logger.warn(
          `Album folder repair needs conflicting manual matches resolved for albums ${ids.join(', ')}`,
        )
        ids.forEach((id) => used.add(id))
        return
      }
      const source = albums[0]
      if (!source) return
      if (albums.length === 1 && source.album_key === key && !used.has(source.id)) {
        used.add(source.id)
        return
      }
      const available = albums.find((album) => !used.has(album.id))
      const target =
        available?.id ??
        Number(
          db
            .prepare(
              `INSERT INTO albums (library_id, album_key, ${COPIED_COLUMNS})
         SELECT library_id, @key, ${COPIED_COLUMNS} FROM albums WHERE id = @id`,
            )
            .run({ key, id: source.id }).lastInsertRowid,
        )
      if (available) {
        // Free any old key that belongs to another row before assigning the canonical folder.
        db.prepare(
          'UPDATE albums SET album_key = @temporary WHERE library_id = @library AND album_key = @key AND id <> @id',
        ).run({ temporary: `repair:${target}:${key}`, library: first.library_id, key, id: target })
        db.prepare('UPDATE albums SET album_key = ? WHERE id = ?').run(key, target)
      }
      used.add(target)
      if (target !== source.id) {
        db.prepare(
          `UPDATE albums SET (${COPIED_COLUMNS}) = (SELECT ${COPIED_COLUMNS} FROM albums WHERE id = ?) WHERE id = ?`,
        ).run(source.id, target)
      }
      const credits = db
        .prepare<[number], { artist_id: number; position: number }>(
          'SELECT artist_id, position FROM album_artists WHERE album_id = ?',
        )
        .all(source.id)
      db.prepare('DELETE FROM album_artists WHERE album_id = ?').run(target)
      credits.forEach((credit) =>
        db
          .prepare('INSERT INTO album_artists (album_id, artist_id, position) VALUES (?, ?, ?)')
          .run(target, credit.artist_id, credit.position),
      )
      files.forEach((file) =>
        db
          .prepare('UPDATE tracks SET album_id = ?, disc = ? WHERE media_id = ?')
          .run(target, Math.max(file.disc, discOfPath(file.path)), file.media_id),
      )
      ids
        .filter((id) => id !== target)
        .forEach((id) => {
          db.prepare(`UPDATE albums SET
          year = COALESCE(year, (SELECT year FROM albums WHERE id = @from)),
          original_year = COALESCE(original_year, (SELECT original_year FROM albums WHERE id = @from)),
          release_date = COALESCE(release_date, (SELECT release_date FROM albums WHERE id = @from)),
          label = COALESCE(label, (SELECT label FROM albums WHERE id = @from)) WHERE id = @target`).run(
            { from: id, target },
          )
          db.prepare(`UPDATE albums SET (cover_source, cover_ref, cover_stamp) =
          (SELECT cover_source, cover_ref, cover_stamp FROM albums WHERE id = @from)
          WHERE id = @target AND cover_source IS NULL AND EXISTS (
            SELECT 1 FROM albums peer WHERE peer.id = @from AND
              (peer.cover_source = 'file' OR (peer.cover_source = 'embedded' AND EXISTS (
                SELECT 1 FROM tracks WHERE album_id = @target AND media_id = CAST(peer.cover_ref AS INTEGER)))))`).run(
            { from: id, target },
          )
        })
      const earliest = albums.map((album) => album.added_at).toSorted()[0]
      if (earliest) db.prepare('UPDATE albums SET added_at = ? WHERE id = ?').run(earliest, target)
      ids.forEach((id) => {
        // A split copies a favourite to each folder; a merge retains each account's earliest mark.
        const accounts = db
          .prepare<[number], { account_id: string }>(
            'SELECT account_id FROM album_favourites WHERE album_id = ?',
          )
          .all(id)
        accounts.forEach(({ account_id: account }) =>
          db
            .prepare(
              `INSERT INTO album_favourites (account_id, album_id, added_at)
           SELECT account_id, @target, added_at FROM album_favourites WHERE account_id = @account AND album_id = @id
           ON CONFLICT (account_id, album_id) DO UPDATE SET added_at = MIN(added_at, excluded.added_at)`,
            )
            .run({ account, target, id }),
        )
      })
    })
    db.exec(`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks);
      UPDATE albums SET cover_source = NULL, cover_ref = NULL, cover_stamp = ''
       WHERE cover_source = 'embedded' AND NOT EXISTS (
         SELECT 1 FROM tracks WHERE album_id = albums.id AND media_id = CAST(albums.cover_ref AS INTEGER));`)
  })()
}
