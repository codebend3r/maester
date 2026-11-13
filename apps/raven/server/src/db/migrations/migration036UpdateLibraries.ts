// A locked library is never in the hero.
export const MIGRATION_036 = `
  UPDATE libraries SET in_hero = 0 WHERE locked = 1;
  `
