import { MARKER_KINDS, MARKER_SOURCES, type Marker, type MarkerSource, isMarker } from '@raven/core'
import type Sqlite from 'better-sqlite3'

/** Where a file stands in detection: waiting, analysed (markers found or not), or failed. */
export const MARKER_STATES = {
  pending: 'pending',
  done: 'done',
  failed: 'failed',
} as const

/** The sources strongest first, as `MARKER_SOURCES` lists them. */
const STRENGTH: readonly MarkerSource[] = Object.values(MARKER_SOURCES)

type ReplacesProps = { offered: MarkerSource; held: MarkerSource }

/** Whether a marker from `offered` takes the place of one from `held`: as strong or stronger, and never over an admin's own. */
const replaces = ({ offered, held }: ReplacesProps): boolean =>
  held !== MARKER_SOURCES.manual && STRENGTH.indexOf(offered) <= STRENGTH.indexOf(held)

type MarkerRow = {
  kind: string
  start_s: number
  end_s: number
  source: string
  confidence: number
}

type OfferMarkersProps = {
  db: Sqlite.Database
  mediaId: number
  markers: readonly Marker[]
  at?: Date
}

/**
 * Stores each marker unless the file holds a stronger one of its kind: a
 * named chapter replaces a detected stretch, a detector run again replaces
 * its own last answer, and nothing replaces an admin's. Run it inside the
 * caller's transaction where there is one.
 */
export const offerMarkers = ({
  db,
  mediaId,
  markers,
  at = new Date(),
}: OfferMarkersProps): void => {
  const held = db.prepare<[number, string], { source: string }>(
    'SELECT source FROM media_markers WHERE media_id = ? AND kind = ?',
  )
  const save = db.prepare(
    `INSERT INTO media_markers (media_id, kind, start_s, end_s, source, confidence, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (media_id, kind) DO UPDATE SET start_s = excluded.start_s, end_s = excluded.end_s,
       source = excluded.source, confidence = excluded.confidence, detected_at = excluded.detected_at`,
  )
  markers
    .filter((marker) => {
      const stored = held.get(mediaId, marker.kind)?.source ?? null
      const source = STRENGTH.find((known) => known === stored)
      return source === undefined || replaces({ offered: marker.source, held: source })
    })
    .forEach(({ kind, start, end, source, confidence }) =>
      save.run(mediaId, kind, start, end, source, confidence, at.toISOString()),
    )
}

type ForgetDetectedMarkersProps = { db: Sqlite.Database; mediaId: number }

/** Drops what a file's chapters and the detectors said, for a file replaced on disk; an admin's own stay. */
export const forgetDetectedMarkers = ({ db, mediaId }: ForgetDetectedMarkersProps): void => {
  db.prepare('DELETE FROM media_markers WHERE media_id = ? AND source <> ?').run(
    mediaId,
    MARKER_SOURCES.manual,
  )
}

type ReadMarkersProps = { db: Sqlite.Database; mediaId: number }

/** The file's intro and credits, each null when none is stored or the stored one no longer reads. */
export const readMarkers = ({
  db,
  mediaId,
}: ReadMarkersProps): { intro: Marker | null; credits: Marker | null } => {
  const markers = db
    .prepare<[number], MarkerRow>(
      'SELECT kind, start_s, end_s, source, confidence FROM media_markers WHERE media_id = ?',
    )
    .all(mediaId)
    .map((row) => ({
      kind: row.kind,
      start: row.start_s,
      end: row.end_s,
      source: row.source,
      confidence: row.confidence,
    }))
    .filter(isMarker)
  return {
    intro: markers.find(({ kind }) => kind === MARKER_KINDS.intro) ?? null,
    credits: markers.find(({ kind }) => kind === MARKER_KINDS.credits) ?? null,
  }
}
