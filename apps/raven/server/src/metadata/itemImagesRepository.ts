import { Inject, Injectable } from '@nestjs/common'
import { IMAGE_SOURCES, ITEM_IMAGE_KINDS, type ItemImageKind } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { PictureVersions } from '@/metadata/pictureVersions'

/** `chosen` is what Edit images picked, a TMDB path; it beats a local picture, which beats TMDB's own. */
export const STORED_IMAGE_SOURCES = { ...IMAGE_SOURCES, chosen: 'chosen' } as const

export type StoredImageSource = (typeof STORED_IMAGE_SOURCES)[keyof typeof STORED_IMAGE_SOURCES]

/** Where an item's picture comes from: a file beside the media wins over TMDB's. */
export type ImageRef = { source: StoredImageSource; ref: string }

/** The picture each item shows for `kind`: the chosen one first, then local, then TMDB's. */
const IMAGE_REFS = `
  SELECT item_id, source, ref FROM item_images
   WHERE kind = ? AND item_id IN (SELECT value FROM json_each(?))
   ORDER BY item_id, CASE source WHEN 'chosen' THEN 0 WHEN 'local' THEN 1 ELSE 2 END`

/** An item and the two above it, where it has them: an episode's season and show. */
export type ItemLine = { id: number; parent: number | null; grandparent: number | null }

/** The items a poster or backdrop may come from, nearest first. */
export const lineOf = (line: ItemLine): number[] =>
  [line.id, line.parent, line.grandparent].filter((id): id is number => id != null)

const toImageSource = (source: string): StoredImageSource =>
  Object.values(STORED_IMAGE_SOURCES).find((known) => known === source) ?? STORED_IMAGE_SOURCES.tmdb

/**
 * The pictures each item holds, from TMDB, from beside the media and from
 * Edit images, and which of them it shows. TMDB's own are stored with the
 * rest of an item, by `MetadataRepository.save`.
 */
@Injectable()
export class ItemImagesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  /** Replaces an item's pictures from beside the media; a kind left out has none. */
  setLocalImages({
    itemId,
    images,
  }: {
    itemId: number
    images: Partial<Record<ItemImageKind, string>>
  }): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM item_images WHERE item_id = ? AND source = 'local'`).run(itemId)
      const insert = this.db.prepare(
        `INSERT INTO item_images (item_id, kind, source, ref) VALUES (?, ?, 'local', ?)`,
      )
      Object.entries(images).forEach(([kind, ref]) => insert.run(itemId, kind, ref))
    })()
  }

  /** The picture an item shows for `kind`, or null when it has none. */
  image({ itemId, kind }: { itemId: number; kind: ItemImageKind }): ImageRef | null {
    const row = this.db
      .prepare<[string, string], { item_id: number; source: string; ref: string }>(IMAGE_REFS)
      .get(kind, JSON.stringify([itemId]))
    if (!row) return null
    return { source: toImageSource(row.source), ref: row.ref }
  }

  /** The picture of `source` an item holds for `kind`, whatever it shows. */
  imageFrom({
    itemId,
    kind,
    source,
  }: {
    itemId: number
    kind: ItemImageKind
    source: StoredImageSource
  }): string | null {
    return (
      this.db
        .prepare<[number, string, string], { ref: string }>(
          `SELECT ref FROM item_images WHERE item_id = ? AND kind = ? AND source = ?`,
        )
        .get(itemId, kind, source)?.ref ?? null
    )
  }

  /** Edit images: the item shows TMDB's picture at `ref` for `kind` from now on, or, for null, whatever it would by itself. */
  chooseImage({
    itemId,
    kind,
    ref,
  }: {
    itemId: number
    kind: ItemImageKind
    ref: string | null
  }): void {
    this.replaceImage({ itemId, kind, source: STORED_IMAGE_SOURCES.chosen, ref })
  }

  /** Keeps TMDB's logo for a movie, or, for null, notes that TMDB has none. */
  setTmdbLogo({ itemId, logo }: { itemId: number; logo: string | null }): void {
    this.replaceImage({
      itemId,
      kind: ITEM_IMAGE_KINDS.logo,
      source: STORED_IMAGE_SOURCES.tmdb,
      ref: logo,
    })
  }

  /** The item's picture of `source` for `kind` becomes `ref`, or goes for null. */
  private replaceImage({
    itemId,
    kind,
    source,
    ref,
  }: {
    itemId: number
    kind: ItemImageKind
    source: StoredImageSource
    ref: string | null
  }): void {
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM item_images WHERE item_id = ? AND kind = ? AND source = ?`)
        .run(itemId, kind, source)
      if (ref != null) {
        this.db
          .prepare(`INSERT INTO item_images (item_id, kind, source, ref) VALUES (?, ?, ?, ?)`)
          .run(itemId, kind, source, ref)
      }
    })()
  }

  /** The version of the picture each item shows for `kind`; one with none is left out. */
  versions({ ids, kind }: { ids: readonly number[]; kind: ItemImageKind }): Map<number, string> {
    const rows = this.db
      .prepare<[string, string], { item_id: number; source: string; ref: string }>(IMAGE_REFS)
      .all(kind, JSON.stringify(ids))
    return rows.reduce(
      (versions, row) =>
        versions.has(row.item_id)
          ? versions
          : versions.set(
              row.item_id,
              this.pictureVersions.item({
                id: row.item_id,
                kind,
                source: row.source,
                ref: row.ref,
              }),
            ),
      new Map<number, string>(),
    )
  }

  /** Each item with the two above it, for a picture to come from the nearest that has one. */
  lines(ids: readonly number[]): ItemLine[] {
    return this.db
      .prepare<[string], ItemLine>(
        `SELECT i.id, p.id AS parent, g.id AS grandparent
           FROM shown_items i
           LEFT JOIN shown_items p ON p.id = i.parent_id
           LEFT JOIN shown_items g ON g.id = p.parent_id
          WHERE i.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify([...new Set(ids)]))
  }

  /**
   * The backdrop that stands for an item: its own, else the nearest above
   * it with one, so an episode shows its show's. null when there is none up
   * the line.
   */
  backdropFor(itemId: number): { id: number; version: string } | null {
    const ids = this.lines([itemId]).flatMap(lineOf)
    const versions = this.versions({ ids, kind: 'backdrop' })
    const found = ids.flatMap((id) => {
      const version = versions.get(id)
      return version == null ? [] : [{ id, version }]
    })
    return found[0] ?? null
  }
}
