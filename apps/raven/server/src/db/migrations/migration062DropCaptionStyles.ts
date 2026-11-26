/**
 * Each device keeps its own subtitle look now, so a TV and a phone on the
 * same account can draw them differently; the account wide copy goes.
 */
export const MIGRATION_062 = `
  DROP TABLE caption_styles;
  `
