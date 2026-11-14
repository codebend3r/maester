/*
 * The video keyframes of a file in seconds, a JSON array probed once on its
 * first HLS play and cleared when the file changes, like its tracks.
 */
export const MIGRATION_033 = `
  ALTER TABLE media ADD COLUMN keyframes TEXT;
  `
