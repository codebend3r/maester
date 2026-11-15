import { Inject, Injectable } from '@nestjs/common'
import {
  type MatchItemType,
  type Upcoming,
  UPCOMING_PAGE_SIZE,
  UPCOMING_SHELF_SIZES,
  UPCOMING_SHELVES,
  type UpcomingPage,
  type UpcomingShelf,
  type UpcomingTitle,
  uniqueUpcomingTitles,
} from '@raven/core'
import { CLOCK, type Clock, utcDayOf } from '@/clock'
import { TmdbClient, UPCOMING_LISTS } from '@/metadata/tmdbClient'
import type { DiscoveredPage, DiscoveredTitle } from '@/metadata/tmdbShapes'
import { FreshReads } from '@/freshReads'
import { SHELF_STREAMS, type ShelfStream, UPCOMING_FRESH_MS } from '@/upcoming/shelfStreams'
import { isAnime } from '@/upcoming/upcomingKind'

/** How many results a page of TMDB's discover holds, its last page aside. */
const TMDB_PAGE_SIZE = 20

/** The last page TMDB's discover answers; it refuses any past it. */
const TMDB_LAST_PAGE = 500

/** How many of TMDB's pages are kept, across every shelf, before the oldest go. */
const HELD_PAGES = 200

/**
 * Where a shelf's pages have got to: the day its lists start from, so a
 * cursor read after midnight carries on where it was, and how far into each
 * list it is, counting every result TMDB sent.
 */
type Cursor = { from: string; offsets: readonly number[] }

const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2})_(\d+(?:\.\d+)*)$/

type CursorOfProps = { after: string; streams: number }

/** The cursor `after` spells for a shelf of `streams` lists, or null when it spells none. */
export const cursorOf = ({ after, streams }: CursorOfProps): Cursor | null => {
  const match = CURSOR_PATTERN.exec(after)
  const from = match?.[1] ?? null
  const offsets = match?.[2]?.split('.').map(Number) ?? []
  if (from === null || offsets.length !== streams) return null
  return { from, offsets }
}

/** `cursor` as `next` sends it: the day, then each list's offset. */
const cursorText = ({ from, offsets }: Cursor): string => `${from}_${offsets.join('.')}`

/** A title read from one of a shelf's lists, at its place in that list. */
type Entry = {
  stream: number
  type: MatchItemType
  raw: number
  title: DiscoveredTitle
  /** Whether the shelf shows it: it has a poster, and is no anime among the movies or shows, which have a shelf of their own. */
  isShown: boolean
}

/** What one list holds from a cursor on: its titles, how far they reach, and whether the list ends there. */
type Window = { offset: number; entries: Entry[]; reach: number; isLast: boolean }

type MergeProps = { lists: readonly (readonly Entry[])[]; merged: readonly Entry[] }

/*
 * The lists' titles as one, the most popular first: the most popular of the
 * lists' next titles, one at a time. Each list keeps TMDB's own order, so a
 * page takes a run from the start of each and its cursor stays true even
 * where TMDB's popularity figures and its order disagree.
 */
const mergedOf = ({ lists, merged }: MergeProps): Entry[] => {
  const top = lists.reduce<Entry | null>((best, list) => {
    const next = list[0]
    if (next === undefined) return best
    return best === null || next.title.popularity > best.title.popularity ? next : best
  }, null)
  if (top === null) return [...merged]
  return mergedOf({
    lists: lists.map((list, stream) => (stream === top.stream ? list.slice(1) : list)),
    merged: [...merged, top],
  })
}

type SafeEndProps = { windows: readonly Window[]; merged: readonly Entry[] }

/*
 * How far into `merged` a page may go: past the last title read from a list
 * that goes on, that list's next title is unknown and could be more popular.
 */
const safeEndOf = ({ windows, merged }: SafeEndProps): number =>
  windows.reduce((end, window) => {
    if (window.isLast) return end
    const last = window.entries.at(-1)
    return last === undefined ? 0 : Math.min(end, merged.indexOf(last) + 1)
  }, merged.length)

/** The first entries of `safe` that hold `UPCOMING_PAGE_SIZE` titles the shelf shows, or all of them. */
const takenOf = (safe: readonly Entry[]): Entry[] => {
  const shown = safe.flatMap((entry, index) => (entry.isShown ? index : []))
  return safe.slice(0, (shown[UPCOMING_PAGE_SIZE - 1] ?? safe.length - 1) + 1)
}

type OffsetsProps = { windows: readonly Window[]; taken: readonly Entry[] }

/** How far into each list the next page starts: past its last title taken, or its whole window. */
const offsetsAfter = ({ windows, taken }: OffsetsProps): number[] =>
  windows.map((window, index) => {
    const read = taken.filter((entry) => entry.stream === index)
    if (read.length === window.entries.length) return window.reach
    return (read.at(-1)?.raw ?? window.offset - 1) + 1
  })

const upcomingTitleOf = ({ type, title, isShown }: Entry): UpcomingTitle[] =>
  title.poster == null || !isShown
    ? []
    : [
        {
          type,
          tmdbId: title.tmdbId,
          title: title.title,
          released: title.released,
          poster: title.poster,
        },
      ]

type PageOfProps = { from: string; windows: readonly Window[] }

/** The page the lists' windows make, merged by popularity, and the cursor of the page after it. */
const pageOf = ({ from, windows }: PageOfProps): UpcomingPage => {
  const merged = mergedOf({ lists: windows.map((window) => window.entries), merged: [] })
  const taken = takenOf(merged.slice(0, safeEndOf({ windows, merged })))
  const offsets = offsetsAfter({ windows, taken })
  const isDone = windows.every(
    (window, index) => window.isLast && (offsets[index] ?? 0) >= window.reach,
  )
  return {
    titles: uniqueUpcomingTitles(taken.flatMap(upcomingTitleOf)),
    next: isDone ? null : cursorText({ from, offsets }),
  }
}

type NumberedPage = { number: number; page: DiscoveredPage }

type WindowProps = { stream: ShelfStream; index: number; from: string; offset: number }

type PageProps = ShelfStream & { from: string; page: number }

type ReadProps = { shelf: UpcomingShelf; after: string | null }

type PageFromProps = { shelf: UpcomingShelf; cursor: Cursor }

/**
 * Coming soon's shelves, the most popular first: TMDB's lists read from
 * today on, documentaries and anime of both kinds merged by popularity,
 * titles with no poster yet left out, and anime kept to its own shelf. Coming soon's own page shows the start of
 * each shelf's first page, so a shelf's page carries on from the very titles
 * it showed. Each of TMDB's pages is kept six hours, so everyone shares one
 * read of it and scrolling on asks TMDB once for each.
 */
@Injectable()
export class UpcomingShelfPages {
  private readonly pages: FreshReads<DiscoveredPage>

  constructor(
    @Inject(TmdbClient) private readonly tmdb: Pick<TmdbClient, 'upcoming'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.pages = new FreshReads({ clock, freshMs: UPCOMING_FRESH_MS, most: HELD_PAGES })
  }

  /** The three shelves as Coming soon's own page shows them: the first titles of each. Rejects with TMDB's error when a read fails. */
  async shelves(): Promise<Upcoming> {
    const startOf = async (shelf: UpcomingShelf): Promise<UpcomingTitle[]> =>
      (await this.first(shelf)).titles.slice(0, UPCOMING_SHELF_SIZES[shelf])
    const [movies, shows, documentaries, anime] = await Promise.all([
      startOf(UPCOMING_SHELVES.movies),
      startOf(UPCOMING_SHELVES.shows),
      startOf(UPCOMING_SHELVES.documentaries),
      startOf(UPCOMING_SHELVES.anime),
    ])
    return { movies, shows, documentaries, anime }
  }

  /** The page after `after`, or the first; null when `after` is no cursor of this shelf's. */
  async read({ shelf, after }: ReadProps): Promise<UpcomingPage | null> {
    if (after === null) return this.first(shelf)
    const cursor = cursorOf({ after, streams: SHELF_STREAMS[shelf].length })
    return cursor === null ? null : this.pageFrom({ shelf, cursor })
  }

  /** A shelf's first page, its lists read from today on. */
  private first(shelf: UpcomingShelf): Promise<UpcomingPage> {
    const cursor = {
      from: utcDayOf(this.clock.now()),
      offsets: SHELF_STREAMS[shelf].map(() => 0),
    }
    return this.pageFrom({ shelf, cursor })
  }

  private async pageFrom({ shelf, cursor }: PageFromProps): Promise<UpcomingPage> {
    const windows = await Promise.all(
      SHELF_STREAMS[shelf].map((stream, index) =>
        this.window({ stream, index, from: cursor.from, offset: cursor.offsets[index] ?? 0 }),
      ),
    )
    return pageOf({ from: cursor.from, windows })
  }

  /** Up to two of TMDB's pages of one list from `offset` on, the second only when the list goes on. */
  private async window({ stream, index, from, offset }: WindowProps): Promise<Window> {
    const firstNumber = Math.floor(offset / TMDB_PAGE_SIZE) + 1
    const first = {
      number: firstNumber,
      page: await this.page({ ...stream, from, page: firstNumber }),
    }
    const hasMore = firstNumber * TMDB_PAGE_SIZE < first.page.total && firstNumber < TMDB_LAST_PAGE
    const read: NumberedPage[] = hasMore
      ? [
          first,
          {
            number: firstNumber + 1,
            page: await this.page({ ...stream, from, page: firstNumber + 1 }),
          },
        ]
      : [first]
    const last = read.at(-1) ?? first
    const reach = Math.max(offset, (last.number - 1) * TMDB_PAGE_SIZE + last.page.size)
    return {
      offset,
      entries: read
        .flatMap(({ number, page }) =>
          page.titles.map(({ at, title }) => ({
            stream: index,
            type: stream.type,
            raw: (number - 1) * TMDB_PAGE_SIZE + at,
            title,
            isShown:
              title.poster != null && !(stream.list === UPCOMING_LISTS.general && isAnime(title)),
          })),
        )
        .filter((entry) => entry.raw >= offset),
      reach,
      isLast:
        reach >= last.page.total ||
        last.page.size < TMDB_PAGE_SIZE ||
        last.number >= TMDB_LAST_PAGE,
    }
  }

  /** One of TMDB's pages, from the last six hours' reads while it holds it. */
  private page({ type, list, from, page }: PageProps): Promise<DiscoveredPage> {
    return this.pages.read({
      key: [type, list, from, page].join('|'),
      read: () => this.tmdb.upcoming({ type, list, from, page }),
    })
  }
}
