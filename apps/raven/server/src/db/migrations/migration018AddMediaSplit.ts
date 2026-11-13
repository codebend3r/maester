/*
 * A movie's files in one library share its card unless split apart:
 * NULL keeps a file on the movie's own card, 'file:<id>' gives it a card
 * of its own, named by its media id, and 'cut:<label>' one it shares with
 * the movie's other files of that cut. Kept on the file, so rescans and
 * renames keep it too; matching the file to another movie clears it.
 */
export const MIGRATION_018 = `
  ALTER TABLE media ADD COLUMN split TEXT;
  `
