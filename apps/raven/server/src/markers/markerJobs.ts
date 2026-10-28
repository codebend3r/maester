import { Inject, Injectable } from '@nestjs/common'
import { type Marker, isChapter, listOf } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import type { StoredHead } from '@/markers/introDetector'
import { MARKER_STATES, offerMarkers } from '@/markers/markerRows'

/**
 * The detector's version. Raising it analyses every season again, as an
 * improved detector should; files analysed by an older one keep their
 * markers until then.
 */
export const MARKER_DETECTOR_VERSION = 1

/** The fingerprint format's version; a kept fingerprint of another is made again. */
const FINGERPRINT_VERSION = 1

/** The region of a file a head fingerprint covers, from its start. */
const REGIONS = { head: 'head' } as const

const isChapters = listOf(isChapter)

/** One file of a season's episodes, as detection reads it. */
export type EpisodeFile = {
  id: number
  path: string
  duration: number
  /** The episode's number in its season; a file of several counts as its first. */
  episode: number
  chapterStarts: number[]
}

type EpisodeRow = {
  id: number
  path: string
  duration: number
  episode: number
  chapters: string | null
}

type MarkerJobsSaveHeadProps = StoredHead & { id: number }

type MarkerJobsFinishProps = {
  ids: readonly number[]
  intros: ReadonlyMap<number, Marker>
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
 * What intro detection reads and writes: the seasons waiting for it, the
 * files of one season, the kept head fingerprints, and each file's state
 * once its season is analysed.
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
  seasonsDue(): number[] {
    return this.db
      .prepare<[string, number], { season_id: number }>(
        `SELECT DISTINCT e.parent_id AS season_id
           FROM media m
           JOIN media_items mi ON mi.media_id = m.id
           JOIN items e ON e.id = mi.item_id AND e.type = 'episode'
          WHERE m.probed = 1 AND m.probe_error IS NULL AND m.duration > 0
            AND e.parent_id IS NOT NULL
            AND (m.markers = ? OR m.markers_version < ?)
          ORDER BY e.parent_id`,
      )
      .all(MARKER_STATES.pending, MARKER_DETECTOR_VERSION)
      .map(({ season_id }) => season_id)
  }

  /** The files of a season's episodes, in episode order, the biggest picture first among an episode's versions. */
  episodesOf(seasonId: number): EpisodeFile[] {
    const rows = this.db
      .prepare<[number], EpisodeRow>(
        `SELECT m.id, m.path, m.duration, MIN(e.number) AS episode, m.chapters
           FROM items e
           JOIN media_items mi ON mi.item_id = e.id
           JOIN media m ON m.id = mi.media_id
          WHERE e.parent_id = ? AND e.type = 'episode'
            AND m.probed = 1 AND m.probe_error IS NULL AND m.duration > 0
          GROUP BY m.id
          ORDER BY episode, COALESCE(m.width * m.height, 0) DESC, m.id`,
      )
      .all(seasonId)
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

  /** The kept head fingerprint of a file, or null when none of this format is kept. */
  storedHead(id: number): StoredHead | null {
    const row = this.db
      .prepare<[number, string, number], { seconds: number; data: Buffer }>(
        `SELECT seconds, data FROM media_fingerprints
          WHERE media_id = ? AND region = ? AND version = ?`,
      )
      .get(id, REGIONS.head, FINGERPRINT_VERSION)
    return row ? { seconds: row.seconds, points: unpack(row.data) } : null
  }

  saveHead({ id, seconds, points }: MarkerJobsSaveHeadProps): void {
    this.db
      .prepare(
        `INSERT INTO media_fingerprints (media_id, region, version, seconds, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (media_id, region) DO UPDATE SET version = excluded.version,
           seconds = excluded.seconds, data = excluded.data`,
      )
      .run(id, REGIONS.head, FINGERPRINT_VERSION, seconds, pack(points))
  }

  /** A season analysed: the intros found offered as markers, and every file marked done or failed by this detector. */
  finish({ ids, intros, failed }: MarkerJobsFinishProps): void {
    const mark = this.db.prepare('UPDATE media SET markers = ?, markers_version = ? WHERE id = ?')
    this.db.transaction(() => {
      intros.forEach((marker, mediaId) => offerMarkers({ db: this.db, mediaId, markers: [marker] }))
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
