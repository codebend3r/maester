import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  type DuplicateCard,
  type DuplicateFile,
  type Duplicates,
  SPLIT_HOWS,
  type SplitHow,
  canSplitByCut,
  readCut,
  sortTitle,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import { BEST_FIRST, FIRST_ITEM } from '@/media/mediaSql'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** A movie's file in a library: the card it sits on, and TMDB's own titles for the movie. */
type FileRow = {
  id: number
  item_id: number
  entry: string
  file_name: string
  title: string
  original_title: string | null
}

const cardOf = (row: FileRow): string => `${row.item_id}|${row.entry}`

const cutOf = (row: FileRow) =>
  readCut({ fileName: row.file_name, titles: [row.title, row.original_title] })

type GroupByProps<T> = { rows: readonly T[]; key: (row: T) => string }

/** Rows gathered by `key`, each group keeping the rows' order. */
const groupBy = <T>({ rows, key }: GroupByProps<T>) =>
  rows.reduce(
    (groups, row) => groups.set(key(row), [...(groups.get(key(row)) ?? []), row]),
    new Map<string, T[]>(),
  )

type TitleOfProps = { cards: readonly DuplicateCard[] }

/** A movie's title as it sorts, "The Whale" under W, from its first card. */
const titleOf = ({ cards }: TitleOfProps): string => {
  const media = cards[0]?.entry.media
  return sortTitle(media?.item?.title ?? media?.title ?? '')
}

type ByTitleProps = TitleOfProps

/** Movies in the order of their titles, as the listing sorts them. */
const byTitle = (a: ByTitleProps, b: ByTitleProps) =>
  titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' })

type MovieSplitsListProps = { libraryId: number; account: AccountKey }

type MovieSplitsSplitProps = {
  libraryId: number
  mediaId: number
  how: SplitHow
  account: AccountKey
}

type MovieSplitsJoinProps = {
  libraryId: number
  itemId: number
  account: AccountKey
}

/**
 * A movie library's duplicates: the movies with more than one file, whose
 * cards are split apart into one per file or per cut, and put back
 * together. Splits sit on the files themselves, as `media.split`, which the
 * listing reads.
 */
@Injectable()
export class MovieSplits {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaRepository) private readonly media: MediaRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /** Every file in the library that is a movie, best first, with the card its `split` puts it on. */
  private files(libraryId: number): FileRow[] {
    return this.db
      .prepare<[number], FileRow>(
        `SELECT m.id, mi.item_id, COALESCE(m.split, '') AS entry, m.file_name,
                t.title, t.original_title
           FROM media m
           JOIN ${FIRST_ITEM}
           JOIN items t ON t.id = mi.item_id AND t.type = 'movie'
          WHERE m.library_id = ?
          ORDER BY ${BEST_FIRST}`,
      )
      .all(libraryId)
  }

  /**
   * The movies with more than one file in the library, by title, each with
   * its cards: one while its files share it, more once split apart, the
   * movie's own card first. Every file is read in one go, and every card's
   * poster in another, however many movies there are. Each file is as
   * `account` sees it.
   */
  list({ libraryId, account }: MovieSplitsListProps): Duplicates {
    const movies = [
      ...groupBy({ rows: this.files(libraryId), key: (row) => String(row.item_id) }).values(),
    ].flatMap((files) => {
      const [first] = files
      if (!first || files.length < 2) return []
      const cards = [...groupBy({ rows: files, key: cardOf }).values()].toSorted(
        (a, b) => Number(a[0]?.entry !== '') - Number(b[0]?.entry !== ''),
      )
      return [{ itemId: first.item_id, cards }]
    })
    const media = new Map(
      this.media
        .getMany({ ids: movies.flatMap(({ cards }) => cards.flat().map((row) => row.id)), account })
        .map((item) => [item.id, item]),
    )
    const filed = movies.map(({ itemId, cards }) => ({
      itemId,
      cards: cards.map((rows): DuplicateFile[] =>
        rows.flatMap((row) => {
          const found = media.get(row.id)
          return found ? [{ media: found, cut: cutOf(row) }] : []
        }),
      ),
    }))
    const entries = new Map(
      this.media
        .withPosters(filed.flatMap(({ cards }) => cards.flatMap(([first]) => first?.media ?? [])))
        .map((entry) => [entry.media.id, entry]),
    )
    return filed
      .map(({ itemId, cards }) => ({
        itemId,
        cards: cards.flatMap((files): DuplicateCard[] => {
          const [first] = files
          const entry = first ? entries.get(first.media.id) : undefined
          return entry ? [{ entry, files }] : []
        }),
      }))
      .toSorted(byTitle)
  }

  /**
   * Splits the card `mediaId` sits on: `apart` gives each of its files a
   * card of its own; `smart` gives each cut its own, keeping the files of
   * one cut together and those that name no cut on the movie's own card.
   */
  split({ libraryId, mediaId, how, account }: MovieSplitsSplitProps): Duplicates {
    const rows = this.files(libraryId)
    const target = rows.find((row) => row.id === mediaId)
    if (!target) throw new NotFoundException(`No movie file ${mediaId} in library ${libraryId}`)
    const card = rows.filter((row) => cardOf(row) === cardOf(target))
    if (card.length < 2) {
      throw new ConflictException('That card holds one file, so there is nothing to split.')
    }
    const update = this.db.prepare<[string | null, number]>(
      'UPDATE media SET split = ? WHERE id = ?',
    )
    if (how === SPLIT_HOWS.apart) {
      // A file's id outlives a rename, so its card can be named by it.
      this.db.transaction(() => card.forEach((row) => update.run(`file:${row.id}`, row.id)))()
      return this.list({ libraryId, account })
    }
    const files = card.map((row) => ({ row, cut: cutOf(row) }))
    if (!canSplitByCut(files)) {
      throw new ConflictException(
        'Every file on this card reads as the same cut, so there is nothing to tell apart. Split apart gives each file a card of its own.',
      )
    }
    // Each cut's card is named by the first of its files, so copies named two ways share it.
    const byCut = groupBy({ rows: files, key: ({ cut }) => cut?.key ?? '' })
    this.db.transaction(() =>
      [...byCut.values()].forEach((group) => {
        const named = group[0]?.cut
        group.forEach(({ row }) => update.run(named == null ? null : `cut:${named.label}`, row.id))
      }),
    )()
    return this.list({ libraryId, account })
  }

  /** Puts every file of the movie in the library back on its one card. */
  join({ libraryId, itemId, account }: MovieSplitsJoinProps): Duplicates {
    const changed = this.db
      .prepare(
        `UPDATE media SET split = NULL
          WHERE library_id = ? AND split IS NOT NULL
            AND id IN (SELECT media_id FROM media_items WHERE item_id = ?)`,
      )
      .run(libraryId, itemId).changes
    if (changed === 0)
      throw new NotFoundException(`No split movie ${itemId} in library ${libraryId}`)
    return this.list({ libraryId, account })
  }
}
