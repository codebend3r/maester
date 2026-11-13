/*
 * Edit images chooses a picture for one library's card of a title, not
 * for every library holding it. A choice made before goes to each library
 * that held the title, so nothing looks different until one is changed.
 */
export const MIGRATION_041 = `
  CREATE TABLE library_item_images (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    PRIMARY KEY (library_id, item_id, kind)
  );
  CREATE INDEX library_item_images_item ON library_item_images (item_id, kind);
  WITH RECURSIVE under (root, id) AS (
    SELECT item_id, item_id FROM item_images WHERE source = 'chosen'
    UNION
    SELECT u.root, c.id FROM under u JOIN items c ON c.parent_id = u.id
  )
  INSERT OR IGNORE INTO library_item_images (library_id, item_id, kind, ref)
  SELECT DISTINCT m.library_id, c.item_id, c.kind, c.ref
    FROM item_images c
    JOIN under u ON u.root = c.item_id
    JOIN media_items mi ON mi.item_id = u.id
    JOIN media m ON m.id = mi.media_id
   WHERE c.source = 'chosen';
  DELETE FROM item_images WHERE source = 'chosen';
  `
