import { Inject, Injectable } from '@nestjs/common'
import {
  type ItemMetadata,
  type ItemMetadataChange,
  type ItemMetadataState,
  sortTitle,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'

/** The fields Edit metadata can write over, as `items` and `shown_items` hold them. */
type FieldsRow = {
  title: string
  year: number | null
  tagline: string | null
  summary: string | null
  content_rating: string | null
}

const FIELDS = 'title, year, tagline, summary, content_rating'

type OverrideRow = {
  item_id: number
  title: string | null
  sort_title: string | null
  year: number | null
  tagline: string | null
  summary: string | null
  content_rating: string | null
}

/**
 * Edit metadata: what was written over TMDB's words for an item. Pages show
 * it through the `shown_items` view; TMDB's own words stay in `items`, so a
 * refresh never undoes an edit.
 */
@Injectable()
export class ItemOverrides {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  /** Edit metadata: TMDB's own words for an item beside what was written over them, and which fields were. */
  state(itemId: number): ItemMetadataState | null {
    const original = this.db
      .prepare<[number], FieldsRow>(`SELECT ${FIELDS} FROM items WHERE id = ?`)
      .get(itemId)
    if (!original) return null
    const shown = this.db
      .prepare<[number], FieldsRow>(`SELECT ${FIELDS} FROM shown_items WHERE id = ?`)
      .get(itemId)
    const override = this.db
      .prepare<[number], OverrideRow>('SELECT * FROM item_overrides WHERE item_id = ?')
      .get(itemId)
    const fields = (row: FieldsRow | undefined): ItemMetadata => ({
      title: row?.title ?? original.title,
      year: row?.year ?? null,
      tagline: row?.tagline ?? null,
      summary: row?.summary ?? null,
      contentRating: row?.content_rating ?? null,
    })
    const overridden: (keyof ItemMetadata)[] = [
      ...(override?.title != null ? ['title' as const] : []),
      ...(override?.year != null ? ['year' as const] : []),
      ...(override?.tagline != null ? ['tagline' as const] : []),
      ...(override?.summary != null ? ['summary' as const] : []),
      ...(override?.content_rating != null ? ['contentRating' as const] : []),
    ]
    return { shown: fields(shown), original: fields(original), overridden }
  }

  /**
   * Writes a field over TMDB's, or clears one back to TMDB's with null; ''
   * (0 for the year) is written over TMDB's too, and shows as nothing. A
   * field left out stays as it is; an item with nothing written over keeps
   * no row.
   */
  write({ itemId, change }: { itemId: number; change: ItemMetadataChange }): void {
    this.db.transaction(() => {
      const current = this.db
        .prepare<[number], OverrideRow>('SELECT * FROM item_overrides WHERE item_id = ?')
        .get(itemId)
      const next = {
        title: 'title' in change ? (change.title ?? null) : (current?.title ?? null),
        year: 'year' in change ? (change.year ?? null) : (current?.year ?? null),
        tagline: 'tagline' in change ? (change.tagline ?? null) : (current?.tagline ?? null),
        summary: 'summary' in change ? (change.summary ?? null) : (current?.summary ?? null),
        content_rating:
          'contentRating' in change
            ? (change.contentRating ?? null)
            : (current?.content_rating ?? null),
      }
      this.db.prepare('DELETE FROM item_overrides WHERE item_id = ?').run(itemId)
      if (Object.values(next).every((value) => value == null)) return
      this.db
        .prepare(
          `INSERT INTO item_overrides (item_id, title, sort_title, year, tagline, summary, content_rating)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          itemId,
          next.title,
          next.title == null ? null : sortTitle(next.title),
          next.year,
          next.tagline,
          next.summary,
          next.content_rating,
        )
    })()
  }
}
