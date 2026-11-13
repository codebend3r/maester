/*
 * Each library's counts read these rather than every file: the files no
 * match was found for, and the probed files' sizes, for how many are 4K.
 * Both are partial so a read of a library's files by library alone never
 * picks one: a full index sorted by size would scatter that read across
 * the table, where the indexes it uses keep the order files came in.
 * Probing and matching fill them without changing how many files there
 * are, so their statistics stay as a library's first scan left them; that
 * is harmless only while no other read can use them.
 */
export const MIGRATION_024 = `
  CREATE INDEX media_library_unmatched ON media (library_id) WHERE match = 'unmatched';
  CREATE INDEX media_library_probed ON media (library_id, width, height) WHERE width IS NOT NULL;
  `
