/*
 * The Dolby Vision profile, so profile 7, a 4K Blu-ray's, wears a chip of its own. Only an HDR
 * file can be Dolby Vision, so those alone are probed again by the next scan someone starts.
 */
export const MIGRATION_058 = `
  ALTER TABLE media ADD COLUMN dolby_vision_profile INTEGER;
  UPDATE media SET probed = 0 WHERE hdr = 1;
  `
