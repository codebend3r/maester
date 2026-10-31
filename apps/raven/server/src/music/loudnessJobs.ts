import { Inject, Injectable } from '@nestjs/common'
import { LIBRARY_KINDS } from '@raven/core'
import { DatabaseService } from '@/db/database'
import {
  LOUDNESS_STATES,
  LOUDNESS_VERSION,
  REPLAYGAIN_SOURCES,
  type TrackGain,
  albumGainOf,
  integratedOf,
} from '@/music/loudness'

/** A track waiting for the scan. */
export type LoudTrack = { mediaId: number; path: string; duration: number }

type LoudnessJobsMeasuredProps = { mediaId: number; measured: TrackGain }

type GainRow = { gain: number; peak: number | null; duration: number }

/**
 * A music library's track whose gain did not come from its tags, read, and
 * never measured or measured by an older scan. One that failed with this
 * scan waits for its file to change, which files it again as pending.
 */
const DUE = `FROM tracks t
               JOIN media m ON m.id = t.media_id
               JOIN libraries l ON l.id = m.library_id
              WHERE l.kind = @music AND m.probed = 1 AND m.probe_error IS NULL AND m.duration > 0
                AND t.replaygain_source IS NOT @tags
                AND (t.loudness_state = @pending OR t.loudness_version < @version)`

/**
 * A music library's album with no gain though a track of it has one: its
 * tracks' gains all came from tags with no album tag, or its scan stopped
 * before `finishAlbum`. The `EXISTS` reads the rows `finishAlbum` does, so
 * the album leaves the list once it has run.
 */
const GAINLESS_ALBUMS = `SELECT a.id AS album_id FROM albums a
                          WHERE a.replaygain_gain IS NULL
                            AND a.library_id IN (SELECT id FROM libraries WHERE kind = @music)
                            AND EXISTS (SELECT 1 FROM tracks t JOIN media m ON m.id = t.media_id
                                         WHERE t.album_id = a.id AND t.replaygain_gain IS NOT NULL
                                           AND m.duration > 0)`

const DUE_PARAMS = {
  music: LIBRARY_KINDS.music,
  tags: REPLAYGAIN_SOURCES.tags,
  pending: LOUDNESS_STATES.pending,
  version: LOUDNESS_VERSION,
} as const

/**
 * What the loudness scan reads and writes: the albums with a track waiting
 * for it, those tracks, each track's gain once measured, and the album's
 * gain from its tracks'.
 */
@Injectable()
export class LoudnessJobs {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** The albums with a track waiting for the scan, and those missing a gain their tracks' would give. */
  albumsDue(): number[] {
    return this.db
      .prepare<typeof DUE_PARAMS, { album_id: number }>(
        `SELECT t.album_id ${DUE} UNION ${GAINLESS_ALBUMS} ORDER BY album_id`,
      )
      .all(DUE_PARAMS)
      .map(({ album_id }) => album_id)
  }

  /** The album's tracks waiting for the scan, in disc and number order. */
  tracksDue(albumId: number): LoudTrack[] {
    return this.db
      .prepare<typeof DUE_PARAMS & { albumId: number }, LoudTrack>(
        `SELECT t.media_id AS mediaId, m.path, m.duration ${DUE} AND t.album_id = @albumId
          ORDER BY t.disc, t.number, t.media_id`,
      )
      .all({ ...DUE_PARAMS, albumId })
  }

  /** A track measured: its gain and peak, from the scan. */
  measured({ mediaId, measured }: LoudnessJobsMeasuredProps): void {
    this.db
      .prepare(
        `UPDATE tracks SET replaygain_gain = @gain, replaygain_peak = @peak, replaygain_source = @scan,
                           loudness_state = @done, loudness_version = @version
          WHERE media_id = @mediaId`,
      )
      .run({
        mediaId,
        gain: measured.gain,
        peak: measured.peak,
        scan: REPLAYGAIN_SOURCES.scan,
        done: LOUDNESS_STATES.done,
        version: LOUDNESS_VERSION,
      })
  }

  /** A track the scan could not measure, which is not tried again by this scan. */
  failed(mediaId: number): void {
    this.db
      .prepare('UPDATE tracks SET loudness_state = ?, loudness_version = ? WHERE media_id = ?')
      .run(LOUDNESS_STATES.failed, LOUDNESS_VERSION, mediaId)
  }

  /**
   * The album's gain from every track with one, whether its tags or the
   * scan gave it, weighted by length; its peak is the highest track's. An
   * album whose tags carry a gain keeps it, and one with no track gain
   * keeps none.
   */
  finishAlbum(albumId: number): void {
    const rows = this.db
      .prepare<[number], GainRow>(
        `SELECT t.replaygain_gain AS gain, t.replaygain_peak AS peak, m.duration
           FROM tracks t
           JOIN media m ON m.id = t.media_id
          WHERE t.album_id = ? AND t.replaygain_gain IS NOT NULL AND m.duration > 0`,
      )
      .all(albumId)
    if (rows.length === 0) return
    const gain = albumGainOf(
      rows.map(({ gain: trackGain, duration }) => ({
        integrated: integratedOf(trackGain),
        duration,
      })),
    )
    const peaks = rows.flatMap(({ peak }) => (peak === null ? [] : [peak]))
    this.db
      .prepare(
        `UPDATE albums SET replaygain_gain = @gain, replaygain_peak = @peak, replaygain_source = @scan
          WHERE id = @albumId AND replaygain_source IS NOT @tags`,
      )
      .run({
        albumId,
        gain,
        peak: peaks.length === 0 ? null : Math.max(...peaks),
        scan: REPLAYGAIN_SOURCES.scan,
        tags: REPLAYGAIN_SOURCES.tags,
      })
  }
}
