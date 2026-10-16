import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type {
  Duplicates,
  HistoryEntry,
  Home,
  ItemDetails,
  MediaItem,
  PosterEntry,
  Saga,
} from '@raven/core'
import { watchedEdits } from '@/lib/edits'
import type { Edit } from '@/lib/optimistic'
import { queryKeys } from '@/lib/queryClient'
import { itemDetails, itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'

const apply = ({ client, edits }: { client: QueryClient; edits: readonly Edit[] }): void =>
  edits.flatMap((change) => change.plan(client)).forEach(({ write }) => write())

const LISTING = queryKeys.media({ libraryId: 2, search: '', sort: 'title', seed: 0 })

/** Two files on the movie's one card, and a third on a card of its own after a split. */
const cardFile = matchedMovie({ id: 7, versions: 2, position: 40 })
const otherFile = matchedMovie({ id: 8, versions: 2, position: 12 })
const splitFile = matchedMovie({ id: 9, card: 'final', position: 5 })
const anotherMovie = matchedMovie({ id: 10, item: itemSummary({ id: 41 }), position: 3 })
const abroad = matchedMovie({ id: 11, libraryId: 3, position: 9 })

const entry = (media: MediaItem): PosterEntry => ({ media, poster: null })

const home = (overrides: Partial<Home> = {}): Home => ({
  inProgress: [],
  shelves: [],
  ...overrides,
})

const historyEntry = (media: MediaItem): HistoryEntry => ({
  media,
  lastPlayedAt: '2026-10-01T00:00:00.000Z',
  plays: 1,
  furthest: 100,
  watched: false,
  marked: false,
})

describe('watchedEdits', () => {
  it('sets the flag on every file of the card, not on another card of the movie or another movie', () => {
    const client = new QueryClient()
    client.setQueryData(LISTING, [cardFile, otherFile, splitFile, anotherMovie])
    apply({ client, edits: watchedEdits({ media: cardFile, watched: true }) })
    expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([
      { ...cardFile, watched: true, position: 0 },
      { ...otherFile, watched: true, position: 0 },
      splitFile,
      anotherMovie,
    ])
  })

  it('matches a file with no item only by itself', () => {
    const client = new QueryClient()
    const lone = mediaItem({ id: 20, position: 10 })
    const neighbour = mediaItem({ id: 21, position: 10 })
    client.setQueryData(LISTING, [lone, neighbour])
    apply({ client, edits: watchedEdits({ media: lone, watched: true }) })
    expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([
      { ...lone, watched: true, position: 0 },
      neighbour,
    ])
  })

  it('takes the flag off and still zeroes the position when unwatching', () => {
    const client = new QueryClient()
    const watched = { ...cardFile, watched: true, position: 20 }
    client.setQueryData(LISTING, [watched])
    apply({ client, edits: watchedEdits({ media: watched, watched: false }) })
    expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([
      { ...watched, watched: false, position: 0 },
    ])
  })

  it('zeroes the position and drops the card from In progress, in its library and on home', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.inProgress(2), [entry(cardFile), entry(anotherMovie)])
    client.setQueryData(queryKeys.home, home({ inProgress: [entry(otherFile), entry(abroad)] }))
    apply({ client, edits: watchedEdits({ media: cardFile, watched: true }) })
    expect(client.getQueryData<PosterEntry[]>(queryKeys.inProgress(2))).toEqual([
      entry(anotherMovie),
    ])
    expect(client.getQueryData<Home>(queryKeys.home)?.inProgress).toEqual([entry(abroad)])
  })

  it('marks the video, its shelf and its favourites entry', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.mediaItem(7), cardFile)
    client.setQueryData(queryKeys.favourites, [entry(cardFile), entry(abroad)])
    client.setQueryData(
      queryKeys.home,
      home({ shelves: [{ libraryId: 2, type: 'media', media: [cardFile, anotherMovie] }] }),
    )
    apply({ client, edits: watchedEdits({ media: cardFile, watched: true }) })
    const marked = { ...cardFile, watched: true, position: 0 }
    expect(client.getQueryData<MediaItem>(queryKeys.mediaItem(7))).toEqual(marked)
    expect(client.getQueryData<PosterEntry[]>(queryKeys.favourites)).toEqual([
      entry(marked),
      entry(abroad),
    ])
    expect(client.getQueryData<Home>(queryKeys.home)?.shelves).toEqual([
      { libraryId: 2, type: 'media', media: [marked, anotherMovie] },
    ])
  })

  it('covers sagas, duplicates, history and the item versions', () => {
    const client = new QueryClient()
    const marked = { ...cardFile, watched: true, position: 0 }
    const saga: Saga = {
      tmdbId: 's1',
      name: 'Saga',
      backdrop: { type: 'slideshow', motion: 'fade' },
      media: [cardFile, anotherMovie],
    }
    const duplicates: Duplicates = [
      {
        itemId: 40,
        cards: [
          {
            entry: entry(cardFile),
            files: [
              { media: cardFile, cut: null },
              { media: otherFile, cut: null },
            ],
          },
        ],
      },
    ]
    const history = queryKeys.history({ libraryId: 2, show: '', limit: 50 })
    client.setQueryData(queryKeys.sagas(2), [saga])
    client.setQueryData(queryKeys.duplicates(2), duplicates)
    client.setQueryData(history, [historyEntry(cardFile), historyEntry(anotherMovie)])
    client.setQueryData(
      queryKeys.item(40),
      itemDetails({ id: 40, versions: [cardFile, splitFile] }),
    )
    apply({ client, edits: watchedEdits({ media: cardFile, watched: true }) })
    expect(client.getQueryData<Saga[]>(queryKeys.sagas(2))?.at(0)?.media).toEqual([
      marked,
      anotherMovie,
    ])
    const [card] = client.getQueryData<Duplicates>(queryKeys.duplicates(2))?.at(0)?.cards ?? []
    expect(card?.entry.media).toEqual(marked)
    expect(card?.files.map((file) => file.media)).toEqual([
      marked,
      { ...otherFile, watched: true, position: 0 },
    ])
    expect(client.getQueryData<HistoryEntry[]>(history)?.map((each) => each.media)).toEqual([
      marked,
      anotherMovie,
    ])
    expect(client.getQueryData<ItemDetails>(queryKeys.item(40))?.versions).toEqual([
      marked,
      splitFile,
    ])
  })

  it('hands back the same data where nothing changes', () => {
    const client = new QueryClient()
    const settled = { ...cardFile, watched: true, position: 0 }
    const listing = [settled, anotherMovie]
    const inProgress = [entry(anotherMovie)]
    client.setQueryData(LISTING, listing)
    client.setQueryData(queryKeys.inProgress(2), inProgress)
    const plans = watchedEdits({ media: settled, watched: true }).flatMap((change) =>
      change.plan(client),
    )
    expect(plans).toEqual([])
    apply({ client, edits: watchedEdits({ media: settled, watched: true }) })
    expect(client.getQueryData<MediaItem[]>(LISTING)).toBe(listing)
    expect(client.getQueryData<PosterEntry[]>(queryKeys.inProgress(2))).toBe(inProgress)
  })
})
