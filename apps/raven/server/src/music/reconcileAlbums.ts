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
  title: string
}
type Album = { id: number; album_key: string; match: string; mbid: string | null; added_at: string }

const COPIED_COLUMNS = `title, sort_title, year, original_year, mbid, release_group_mbid, type,
  label, genres, is_compilation, credited_by_tags, cover_source, cover_ref, replaygain_gain,
  replaygain_peak, added_at, match, match_confidence, matched_at, release_date, metadata_path, cover_stamp`

type MergeByReleaseProps = { db: Sqlite.Database; groups: Map<string, FiledTrack[]> }
type ReleaseAlbum = { id: number; mbid: string | null; match: string }

/**
 * Folders that belong to one album stay one: they hold the same MusicBrainz
 * release (disc folders not named as discs, artist spellings that differ), or
 * their files are already filed under one album, as a merge of copies of a
 * release leaves them. A manual match is the owner's own choice of release for
 * a folder, so it never joins another.
 */
const mergeByRelease = ({ db, groups }: MergeByReleaseProps): FiledTrack[][] => {
  const releases = new Map(
    db
      .prepare<[], ReleaseAlbum>('SELECT id, mbid, match FROM albums')
      .all()
      .map((album) => [album.id, album]),
  )
  const parent = new Map([...groups.keys()].map((key) => [key, key]))
  const rootOf = (key: string): string => {
    const up = parent.get(key) ?? key
    return up === key ? key : rootOf(up)
  }
  const join = (a: string, b: string): void => {
    parent.set(rootOf(b), rootOf(a))
  }
  const owners = new Map<string, string>()
  groups.forEach((files, key) => {
    const albums = [...new Set(files.map((file) => file.album_id))].flatMap(
      (id) => releases.get(id) ?? [],
    )
    if (albums.some((album) => album.match === MATCH_STATES.manual)) return
    const mbids = [...new Set(albums.map((album) => album.mbid))]
    const [mbid] = mbids
    const shared = [
      ...(mbids.length === 1 && mbid != null
        ? [JSON.stringify([files[0]?.library_id, 'mbid', mbid])]
        : []),
      ...albums.map((album) => JSON.stringify(['album', album.id])),
    ]
    shared.forEach((owner) => {
      const known = owners.get(owner)
      if (known === undefined) owners.set(owner, key)
      else join(known, key)
    })
  })
  const merged = [...groups.entries()].reduce((found, [key, files]) => {
    const root = rootOf(key)
    found.set(root, [...(found.get(root) ?? []), ...files])
    return found
  }, new Map<string, FiledTrack[]>())
  return [...merged.values()].map(numberedByDisc)
}

/**
 * The files of an album in path order, a folder holding other tracks than the
 * ones before it a disc of its own. A folder that holds the same tracks as an
 * earlier one is a second copy, which keeps its disc and is shown once.
 */
const numberedByDisc = (files: FiledTrack[]): FiledTrack[] => {
  const sorted = files.toSorted((a, b) => a.path.localeCompare(b.path))
  const folders = [...new Set(sorted.map((file) => albumFolderOf(file.path)))]
  const titlesOf = (folder: string): string[] =>
    sorted
      .filter((file) => albumFolderOf(file.path) === folder)
      .map((file) => file.title.toLowerCase())
  const discs = folders.reduce((numbers, folder, at) => {
    const titles = titlesOf(folder)
    const isCopy = folders
      .slice(0, at)
      .some((earlier) => titles.every((title) => titlesOf(earlier).includes(title)))
    const next = isCopy ? 0 : Math.max(0, ...numbers.values()) + 1
    return new Map([...numbers, [folder, next]])
  }, new Map<string, number>())
  return sorted.map((file) => {
    const own = Math.max(file.disc, discOfPath(file.path))
    const place = discs.get(albumFolderOf(file.path)) ?? 0
    return { ...file, disc: folders.length > 1 && own === 1 && place > 0 ? place : own }
  })
}

/** Repairs identities without recreating media, playlists, credits or per-account viewing data. */
export const reconcileAlbums = ({ db }: ReconcileAlbumsProps): void => {
  const logger = new Logger('AlbumFolders')
  db.transaction(() => {
    const tracks = db
      .prepare<[], FiledTrack>(
        `SELECT t.media_id, t.album_id, m.library_id, m.path, t.disc, t.title
         FROM tracks t JOIN media m ON m.id = t.media_id ORDER BY m.path, m.id`,
      )
      .all()
    const folderGroups = tracks.reduce((found, track) => {
      const key = JSON.stringify([track.library_id, albumFolderOf(track.path)])
      found.set(key, [...(found.get(key) ?? []), track])
      return found
    }, new Map<string, FiledTrack[]>())
    const groups = mergeByRelease({ db, groups: folderGroups })
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
