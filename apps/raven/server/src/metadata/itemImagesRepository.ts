import { Inject, Injectable } from '@nestjs/common'
import { IMAGE_SOURCES, ITEM_IMAGE_KINDS, type ItemImageKind } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { PictureVersions } from '@/metadata/pictureVersions'

/**
 * `chosen` is what Edit images picked for one library's card, a TMDB path;
 * it beats a local picture, which beats TMDB's own.
 */
export const STORED_IMAGE_SOURCES = { ...IMAGE_SOURCES, chosen: 'chosen' } as const

type StoredImageSource = (typeof STORED_IMAGE_SOURCES)[keyof typeof STORED_IMAGE_SOURCES]

/** Where an item's picture comes from: a file beside the media wins over TMDB's. */
export type ImageRef = { source: StoredImageSource; ref: string }

/**
 * The picture each item shows for `kind` in library `@library`: the one
 * chosen there first, then local, then TMDB's. With no library, as on an
 * item's own page reached from no library, the chosen ones are passed over.
 */
const IMAGE_REFS = `
  SELECT item_id, source, ref FROM (
    SELECT item_id, 'chosen' AS source, ref, 0 AS rank FROM library_item_images
     WHERE library_id = @library AND kind = @kind
       AND item_id IN (SELECT value FROM json_each(@ids))
    UNION ALL
    SELECT item_id, source, ref, CASE source WHEN 'local' THEN 1 ELSE 2 END AS rank
      FROM item_images
     WHERE kind = @kind AND source <> 'chosen'
       AND item_id IN (SELECT value FROM json_each(@ids)))
   ORDER BY item_id, rank`

type ImageRefsParams = { library: number | null; kind: string; ids: string }

type ImageRefRow = { item_id: number; source: string; ref: string }

/** An item and the two above it, where it has them: an episode's season and show. */
export type ItemLine = { id: number; parent: number | null; grandparent: number | null }

/** The items a poster or backdrop may come from, nearest first. */
export const lineOf = (line: ItemLine): number[] =>
  [line.id, line.parent, line.grandparent].filter((id): id is number => id != null)

const toImageSource = (source: string): StoredImageSource =>
  Object.values(STORED_IMAGE_SOURCES).find((known) => known === source) ?? STORED_IMAGE_SOURCES.tmdb

type ItemImagesRepositorySetLocalImagesProps = {
  itemId: number
  images: Partial<Record<ItemImageKind, string>>
}

type ItemImagesRepositoryImageProps = {
  itemId: number
  kind: ItemImageKind
  /** The library whose card it is; null for none, which shows no library's choice. */
  libraryId: number | null
}

type ItemImagesRepositoryImageFromProps = {
  itemId: number
  kind: ItemImageKind
  source: StoredImageSource
}

type ItemImagesRepositoryChooseImageProps = {
  itemId: number
  kind: ItemImageKind
  libraryId: number
  ref: string | null
}

type ItemImagesRepositoryCandidatesProps = { itemId: number; kind: ItemImageKind }

/** A picture an item is shown with somewhere, and the version its address names it by. */
type PictureCandidate = { image: ImageRef; version: string }

type ItemImagesRepositorySetTmdbLogoProps = { itemId: number; logo: string | null }

type ItemImagesRepositoryReplaceImageProps = {
  itemId: number
  kind: ItemImageKind
  source: StoredImageSource
  ref: string | null
}

type ItemImagesRepositoryVersionsProps = {
  ids: readonly number[]
  kind: ItemImageKind
  /** The library whose cards these are; null for none, which shows no library's choice. */
  libraryId: number | null
}

type ItemImagesRepositoryBackdropForProps = { itemId: number; libraryId: number | null }

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
  setLocalImages({ itemId, images }: ItemImagesRepositorySetLocalImagesProps): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM item_images WHERE item_id = ? AND source = 'local'`).run(itemId)
      const insert = this.db.prepare(
        `INSERT INTO item_images (item_id, kind, source, ref) VALUES (?, ?, 'local', ?)`,
      )
      Object.entries(images).forEach(([kind, ref]) => insert.run(itemId, kind, ref))
    })()
  }

  /** The picture an item shows for `kind` in `libraryId`, or null when it has none. */
  image({ itemId, kind, libraryId }: ItemImagesRepositoryImageProps): ImageRef | null {
    const row = this.db
      .prepare<ImageRefsParams, ImageRefRow>(IMAGE_REFS)
      .get({ library: libraryId, kind, ids: JSON.stringify([itemId]) })
    if (!row) return null
    return { source: toImageSource(row.source), ref: row.ref }
  }

  /** The picture of `source` an item holds for `kind`, whatever it shows. */
  imageFrom({ itemId, kind, source }: ItemImagesRepositoryImageFromProps): string | null {
    return (
      this.db
        .prepare<[number, string, string], { ref: string }>(
          `SELECT ref FROM item_images WHERE item_id = ? AND kind = ? AND source = ?`,
        )
        .get(itemId, kind, source)?.ref ?? null
    )
  }

  /**
   * Edit images: the item's card in `libraryId` shows TMDB's picture at
   * `ref` for `kind` from now on, or, for null, whatever it would by itself.
   * Every other library's card keeps its own.
   */
  chooseImage({ itemId, kind, libraryId, ref }: ItemImagesRepositoryChooseImageProps): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM library_item_images WHERE library_id = ? AND item_id = ? AND kind = ?`,
        )
        .run(libraryId, itemId, kind)
      if (ref != null) {
        this.db
          .prepare(
            `INSERT INTO library_item_images (library_id, item_id, kind, ref) VALUES (?, ?, ?, ?)`,
          )
          .run(libraryId, itemId, kind, ref)
      }
    })()
  }

  /**
   * Every picture an item is shown with for `kind`: its own, and each one a
   * library chose, so a picture's address finds the one it names.
   */
  candidates({ itemId, kind }: ItemImagesRepositoryCandidatesProps): PictureCandidate[] {
    const own = this.image({ itemId, kind, libraryId: null })
    const chosen = this.db
      .prepare<[number, string], { ref: string }>(
        `SELECT DISTINCT ref FROM library_item_images WHERE item_id = ? AND kind = ?`,
      )
      .all(itemId, kind)
      .map((row): ImageRef => ({ source: STORED_IMAGE_SOURCES.chosen, ref: row.ref }))
    return [...(own == null ? [] : [own]), ...chosen].map((image) => ({
      image,
      version: this.pictureVersions.item({ id: itemId, kind, ...image }),
    }))
  }

  /** Keeps TMDB's logo for a movie, or, for null, notes that TMDB has none. */
  setTmdbLogo({ itemId, logo }: ItemImagesRepositorySetTmdbLogoProps): void {
    this.replaceImage({
      itemId,
      kind: ITEM_IMAGE_KINDS.logo,
      source: STORED_IMAGE_SOURCES.tmdb,
      ref: logo,
    })
  }

  /** The item's picture of `source` for `kind` becomes `ref`, or goes for null. */
  private replaceImage({ itemId, kind, source, ref }: ItemImagesRepositoryReplaceImageProps): void {
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

  /** The version of the picture each item shows for `kind` in `libraryId`; one with none is left out. */
  versions({ ids, kind, libraryId }: ItemImagesRepositoryVersionsProps): Map<number, string> {
    const rows = this.db
      .prepare<ImageRefsParams, ImageRefRow>(IMAGE_REFS)
      .all({ library: libraryId, kind, ids: JSON.stringify(ids) })
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
   * it with one, so an episode shows its show's, as `libraryId` shows it.
   * null when there is none up the line.
   */
  backdropFor({
    itemId,
    libraryId,
  }: ItemImagesRepositoryBackdropForProps): { id: number; version: string } | null {
    const ids = this.lines([itemId]).flatMap(lineOf)
    const versions = this.versions({ ids, kind: ITEM_IMAGE_KINDS.backdrop, libraryId })
    const found = ids.flatMap((id) => {
      const version = versions.get(id)
      return version == null ? [] : [{ id, version }]
    })
    return found[0] ?? null
  }
}
