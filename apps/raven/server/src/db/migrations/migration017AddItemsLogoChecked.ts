/*
 * A movie's logo, its title as art, sits in item_images as kind 'logo'.
 * Movies stored before this learn theirs from TMDB once, in the daily
 * sweep; logo_checked marks the ones that have, every item stored after.
 */
export const MIGRATION_017 = `
  ALTER TABLE items ADD COLUMN logo_checked INTEGER NOT NULL DEFAULT 0;
  `
