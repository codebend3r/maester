/*
 * A play is a real one ('played'), one Mark as watched wrote ('marked',
 * which always counts), or a real one Mark as unwatched set aside
 * ('cleared', which stays in the history and never counts). Watched at is
 * now also where a resume spot clears, so a library still at the old
 * default of 90 moves to 95, and a spot at or past its library's
 * threshold, which a watched play would have cleared, goes. A file whose
 * length is unknown has no threshold, so it keeps its spot.
 */
export const MIGRATION_025 = `
  ALTER TABLE plays ADD COLUMN kind TEXT NOT NULL DEFAULT 'played'
    CHECK (kind IN ('played', 'marked', 'cleared'));
  UPDATE libraries SET watched_percent = 95 WHERE watched_percent = 90;
  DELETE FROM playback_progress
   WHERE media_id IN (
     SELECT m.id
       FROM media m
       JOIN libraries l ON l.id = m.library_id
       JOIN playback_progress p ON p.media_id = m.id
      WHERE m.duration > 0 AND p.position >= m.duration * l.watched_percent / 100.0);
  `
