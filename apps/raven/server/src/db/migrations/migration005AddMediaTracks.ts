/*
 * A video's embedded audio and subtitle tracks as JSON, found by the scan's
 * probe so the player need not run ffprobe again. NULL until known.
 */
export const MIGRATION_005 = `
  ALTER TABLE media ADD COLUMN tracks TEXT;
  `
