import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'

/*
 * Each account keeps its own resume spots, plays, watched marks and
 * favourites, so every row names its account. A migration cannot know who
 * owns the server, so what was recorded before goes to the local account,
 * which the owner adopts at runtime; a server without accounts keeps
 * reading and writing it. The rebuilt tables have no default account, so
 * a write that forgets one fails; the plays default only fills the rows
 * already there. A row whose video or title is gone, left by a database
 * that once ran without foreign keys, is not copied, so it cannot stop the
 * start. Each table keeps an index by its video or title, as plays_media
 * stays, so a delete's cascade never reads the whole table. The
 * rebuilt tables are WITHOUT ROWID, keyed by account first: with a
 * handful of rows a rowid table's key index looked dearer to SQLite than
 * reading the whole table for every card.
 */
export const MIGRATION_031 = `
  CREATE TABLE progress_by_account (
    account_id TEXT NOT NULL,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    position REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, media_id)
  ) WITHOUT ROWID;
  INSERT INTO progress_by_account
    SELECT '${VIEWING_ACCOUNTS.local}', media_id, position, updated_at FROM playback_progress
     WHERE media_id IN (SELECT id FROM media);
  DROP TABLE playback_progress;
  ALTER TABLE progress_by_account RENAME TO playback_progress;
  CREATE INDEX playback_progress_media ON playback_progress (media_id);

  CREATE TABLE favourites_by_account (
    account_id TEXT NOT NULL,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (account_id, media_id)
  ) WITHOUT ROWID;
  INSERT INTO favourites_by_account
    SELECT '${VIEWING_ACCOUNTS.local}', media_id, added_at FROM favourites
     WHERE media_id IN (SELECT id FROM media);
  DROP TABLE favourites;
  ALTER TABLE favourites_by_account RENAME TO favourites;
  CREATE INDEX favourites_media ON favourites (media_id);

  CREATE TABLE item_favourites_by_account (
    account_id TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (account_id, item_id)
  ) WITHOUT ROWID;
  INSERT INTO item_favourites_by_account
    SELECT '${VIEWING_ACCOUNTS.local}', item_id, added_at FROM item_favourites
     WHERE item_id IN (SELECT id FROM items);
  DROP TABLE item_favourites;
  ALTER TABLE item_favourites_by_account RENAME TO item_favourites;
  CREATE INDEX item_favourites_item ON item_favourites (item_id);

  ALTER TABLE plays ADD COLUMN account_id TEXT NOT NULL DEFAULT '${VIEWING_ACCOUNTS.local}';
  CREATE INDEX plays_account ON plays (account_id, media_id, played_at);
  `
