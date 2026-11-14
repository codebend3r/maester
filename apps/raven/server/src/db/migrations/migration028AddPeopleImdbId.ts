/*
 * What TMDB says of a person and everything they appear in, for the person
 * page. `filmography_fetched_at` is null until the credits were fetched, and
 * `department` is TMDB's own, with `Acting` for a cast credit. One person
 * can hold several credits on one title, so `credit_id` is the key.
 */
export const MIGRATION_028 = `
  ALTER TABLE people ADD COLUMN imdb_id TEXT;
  ALTER TABLE people ADD COLUMN birthday TEXT;
  ALTER TABLE people ADD COLUMN deathday TEXT;
  ALTER TABLE people ADD COLUMN place_of_birth TEXT;
  ALTER TABLE people ADD COLUMN biography TEXT;
  ALTER TABLE people ADD COLUMN known_for TEXT;
  ALTER TABLE people ADD COLUMN filmography_fetched_at TEXT;
  CREATE TABLE person_credits (
    person_id INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    credit_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('movie', 'show')),
    tmdb_id TEXT NOT NULL,
    title TEXT NOT NULL,
    released TEXT,
    poster TEXT,
    genre_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genre_ids)),
    department TEXT NOT NULL,
    role TEXT,
    episodes INTEGER,
    position INTEGER NOT NULL,
    PRIMARY KEY (person_id, credit_id)
  );
  `
