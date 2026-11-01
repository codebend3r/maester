import { Inject, Injectable } from '@nestjs/common'
import {
  ITEM_TYPES,
  type Marker,
  type MarkerKind,
  type MarkerSource,
  isChapter,
  listOf,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import type { KeptFingerprint } from '@/markers/fingerprintMatch'
import { MARKER_STATES, offerMarkers, wouldTake } from '@/markers/markerRows'
import type { Region, SeasonFile } from '@/markers/seasonListen'
import type { RegionFingerprint } from '@/markers/seasonMarkers'

/**
 * The detector's version. Raising it analyses every season again, as an
 * improved detector should; files analysed by an older one keep their
 * markers until then.
 */
export const MARKER_DETECTOR_VERSION = 2

/** The fingerprint format's version; a kept fingerprint of another is made again. */
const FINGERPRINT_VERSION = 1

const isChapters = listOf(isChapter)

/** One file of a season's episodes, as detection reads it. */
export type EpisodeFile = SeasonFile & {
  /** The episode's number in its season; a file of several counts as its first. */
  episode: number
}

type EpisodeRow = {
  id: number
  path: string
  duration: number
  episode: number
  chapters: string | null
}

/** A film waiting for detection. */
export type FilmFile = { id: number; path: string; duration: number }

type MarkerJobsStoredProps = { id: number; region: Region }
type MarkerJobsEpisodesOfProps = { seasonId: number; libraryId?: number | null }

type MarkerJobsSaveProps = RegionFingerprint

type MarkerJobsWouldTakeProps = { id: number; kind: MarkerKind; source: MarkerSource }

type MarkerJobsFinishProps = {
  ids: readonly number[]
  markers: ReadonlyMap<number, readonly Marker[]>
  failed: ReadonlySet<number>
}

/** Packs fingerprint points as little-endian uint32, four bytes each. */
const pack = (points: readonly number[]): Buffer =>
  points.reduce(
    (buffer, point, index) => {
      buffer.writeUInt32LE(point >>> 0, index * 4)
      return buffer
    },
    Buffer.alloc(points.length * 4),
  )

const unpack = (data: Buffer): number[] =>
  Array.from({ length: Math.floor(data.length / 4) }, (_, index) => data.readUInt32LE(index * 4))

/**
 * What marker detection reads and writes: the seasons and films waiting
 * for it, the files of one season, the kept fingerprints, and each file's
 * state once it is analysed.
 */
@Injectable()
export class MarkerJobs {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /**
   * The seasons with an episode file waiting for detection: probed, with a
   * length, and never analysed or analysed by an older detector. A season
   * that failed with this one waits for its files to change.
   */
  requestLibrary(libraryId: number): void {
    this.db
      .prepare('UPDATE media SET markers = ? WHERE library_id = ?')
      .run(MARKER_STATES.pending, libraryId)
  }

  seasonsDue(libraryId: number | null = null): number[] {
    return this.db
      .prepare<[string, number, number | null, number | null], { season_id: number }>(
        `SELECT DISTINCT e.parent_id AS season_id
           FROM media m
           JOIN media_items mi ON mi.media_id = m.id
           JOIN items e ON e.id = mi.item_id AND e.type = 'episode'
          WHERE m.probed = 1 AND m.probe_error IS NULL AND m.duration > 0
            AND e.parent_id IS NOT NULL
            AND (m.markers = ? OR m.markers_version < ?)
            AND (? IS NULL OR m.library_id = ?)
          ORDER BY e.parent_id`,
      )
      .all(MARKER_STATES.pending, MARKER_DETECTOR_VERSION, libraryId, libraryId)
      .map(({ season_id }) => season_id)
  }

  /** The films with a file waiting for detection, as `seasonsDue` reads episodes. */
  filmsDue(libraryId: number | null = null): FilmFile[] {
    return this.db
      .prepare<[string, string, number, number | null, number | null], FilmFile>(
        `SELECT DISTINCT m.id, m.path, m.duration
           FROM media m
           JOIN media_items mi ON mi.media_id = m.id
           JOIN items f ON f.id = mi.item_id AND f.type = ?
          WHERE m.probed = 1 AND m.probe_error IS NULL AND m.duration > 0
            AND (m.markers = ? OR m.markers_version < ?)
            AND (? IS NULL OR m.library_id = ?)
          ORDER BY m.id`,
      )
      .all(ITEM_TYPES.movie, MARKER_STATES.pending, MARKER_DETECTOR_VERSION, libraryId, libraryId)
  }

  /** Whether a marker from `source` would be stored over what the file holds, so is worth looking for. */
  wouldTake({ id, kind, source }: MarkerJobsWouldTakeProps): boolean {
    return wouldTake({ db: this.db, mediaId: id, kind, source })
  }

  /** The files of a season's episodes, in episode order, the biggest picture first among an episode's versions. */
  episodesOf({ seasonId, libraryId = null }: MarkerJobsEpisodesOfProps): EpisodeFile[] {
    const rows = this.db
      .prepare<[number, number | null, number | null], EpisodeRow>(
        `SELECT m.id, m.path, m.duration, MIN(e.number) AS episode, m.chapters
           FROM items e
           JOIN media_items mi ON mi.item_id = e.id
           JOIN media m ON m.id = mi.media_id
          WHERE e.parent_id = ? AND e.type = 'episode'
            AND m.probed = 1 AND m.probe_error IS NULL AND m.duration > 0
            AND (? IS NULL OR m.library_id = ?)
          GROUP BY m.id
          ORDER BY episode, COALESCE(m.width * m.height, 0) DESC, m.id`,
      )
      .all(seasonId, libraryId, libraryId)
    return rows.map(({ id, path, duration, episode, chapters }) => ({
      id,
      path,
      duration,
      episode,
      chapterStarts:
        (chapters === null ? null : parseJsonAs({ json: chapters, guard: isChapters }))?.map(
          ({ start }) => start,
        ) ?? [],
    }))
  }

  /** The kept fingerprint of a region of a file, or null when none of this format is kept. */
  stored({ id, region }: MarkerJobsStoredProps): KeptFingerprint | null {
    const row = this.db
      .prepare<[number, string, number], { seconds: number; data: Buffer }>(
        `SELECT seconds, data FROM media_fingerprints
          WHERE media_id = ? AND region = ? AND version = ?`,
      )
      .get(id, region, FINGERPRINT_VERSION)
    return row ? { seconds: row.seconds, points: unpack(row.data) } : null
  }

  save({ id, region, seconds, points }: MarkerJobsSaveProps): void {
    this.db
      .prepare(
        `INSERT INTO media_fingerprints (media_id, region, version, seconds, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (media_id, region) DO UPDATE SET version = excluded.version,
           seconds = excluded.seconds, data = excluded.data`,
      )
      .run(id, region, FINGERPRINT_VERSION, seconds, pack(points))
  }

  /** A season or film analysed: the markers found offered, and every file marked done or failed by this detector. */
  finish({ ids, markers, failed }: MarkerJobsFinishProps): void {
    const mark = this.db.prepare('UPDATE media SET markers = ?, markers_version = ? WHERE id = ?')
    this.db.transaction(() => {
      markers.forEach((found, mediaId) => offerMarkers({ db: this.db, mediaId, markers: found }))
      ids.forEach((id) =>
        mark.run(
          failed.has(id) ? MARKER_STATES.failed : MARKER_STATES.done,
          MARKER_DETECTOR_VERSION,
          id,
        ),
      )
    })()
  }
}
