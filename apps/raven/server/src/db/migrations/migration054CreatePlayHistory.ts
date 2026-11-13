/*
 * Every sitting with a video or a track, however short, by account, for the play history.
 * `id` counts up across every account in the order the sittings started, so it is both the
 * history's order and its page cursor. `kind` says how the entry is kept: a 'video' follows
 * its play (`play_id`) as that sitting's reports come in; a 'listen' follows the reports of
 * the listen its music player started. The plays kept so far start it, oldest first: a
 * video's with how far it got, a music listen's with no reach (NULL), since a listen only
 * ever noted that it counted.
 */
export const MIGRATION_054 = `
  CREATE TABLE play_history (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'listen')),
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    play_id INTEGER,
    started_at TEXT NOT NULL,
    last_played_at TEXT NOT NULL,
    furthest REAL,
    CHECK ((kind = 'video') = (play_id IS NOT NULL))
  );
  CREATE INDEX play_history_account ON play_history (account_id);
  CREATE INDEX play_history_media ON play_history (media_id);
  CREATE UNIQUE INDEX play_history_play ON play_history (play_id) WHERE play_id IS NOT NULL;
  INSERT INTO play_history (account_id, kind, media_id, play_id, started_at, last_played_at, furthest)
    SELECT pl.account_id,
           CASE WHEN t.media_id IS NULL THEN 'video' ELSE 'listen' END,
           pl.media_id,
           CASE WHEN t.media_id IS NULL THEN pl.id END,
           pl.played_at,
           pl.played_at,
           CASE WHEN t.media_id IS NULL OR pl.furthest > 0 THEN pl.furthest END
      FROM plays pl
      LEFT JOIN tracks t ON t.media_id = pl.media_id
     WHERE pl.kind <> 'marked'
     ORDER BY pl.played_at, pl.id;
  `
