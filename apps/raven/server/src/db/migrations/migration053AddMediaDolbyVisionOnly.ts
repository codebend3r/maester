/*
 * Dolby Vision profile 5, which only Dolby Vision can show: a browser plays it purple and
 * green. Only an HDR file can be Dolby Vision, so those alone are probed again by the next
 * scan someone starts, to read it.
 */
export const MIGRATION_053 = `
  ALTER TABLE media ADD COLUMN dolby_vision_only INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX media_library_dolby_vision_only ON media (library_id) WHERE dolby_vision_only = 1;
  UPDATE media SET probed = 0 WHERE hdr = 1;
  `
