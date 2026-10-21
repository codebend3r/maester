import { describe, expect, it } from 'bun:test'
import { QueryClient, type QueryKey, hashKey } from '@tanstack/react-query'
import { MEDIA_SORTS } from '@raven/core'
import {
  EDITED_PARTS,
  afterAiLookups,
  afterFavourites,
  afterItemEdited,
  afterLibraryEvent,
  afterLibrarySaved,
  afterLibraryView,
  afterMatch,
  afterMatchingPass,
  afterPins,
  afterReconnect,
  afterRematch,
  afterRescan,
  afterSagaBackdrop,
  afterSplit,
  afterWatched,
  afterWatching,
} from '@/query/invalidate'
import { queryKeys } from '@/query/queryClient'
import { itemDetails } from '@/test/fixtures'

/** A client holding one query under each key, none of them stale. */
const holding = (keys: readonly QueryKey[]): QueryClient => {
  const client = new QueryClient()
  keys.forEach((key) => client.setQueryData(key, []))
  return client
}

/** One query under each kind of key, so a change shows which of them it reads again. */
const HELD = {
  libraries: queryKeys.libraries,
  library: queryKeys.library(2),
  otherLibrary: queryKeys.library(3),
  listing: queryKeys.media({ libraryId: 2, search: '', sort: MEDIA_SORTS.title, seed: 0 }),
  shows: queryKeys.shows({ libraryId: 2, search: '', sort: MEDIA_SORTS.title, seed: 0 }),
  unmatched: queryKeys.unmatched(2),
  sagas: queryKeys.sagas(2),
  item: queryKeys.item(40),
  itemImages: queryKeys.itemImages(40),
  itemMetadata: queryKeys.itemMetadata(40),
  favourites: queryKeys.favourites,
  home: queryKeys.home,
  media: queryKeys.mediaItem(7),
  lock: queryKeys.lock,
  browse: queryKeys.browse(null),
} as const

const HELD_KEYS: QueryKey[] = Object.values(HELD)

/** Everything under `libraries`, every library's own queries included. */
const EVERY_LIBRARY: QueryKey[] = [
  HELD.libraries,
  HELD.library,
  HELD.otherLibrary,
  HELD.listing,
  HELD.shows,
  HELD.unmatched,
  HELD.sagas,
]

/** What sits under library 2: it and everything it lists. */
const THE_LIBRARY: QueryKey[] = [HELD.library, HELD.listing, HELD.shows, HELD.unmatched, HELD.sagas]

const ITEMS: QueryKey[] = [HELD.item, HELD.itemImages, HELD.itemMetadata]

/** The held keys a change left stale, hashed and sorted so lists compare whatever their order. */
const readAgain = async (
  change: (queryClient: QueryClient) => Promise<unknown>,
): Promise<string[]> => {
  const client = holding(HELD_KEYS)
  await change(client)
  return hashed(HELD_KEYS.filter((key) => !!client.getQueryState(key)?.isInvalidated))
}

const hashed = (keys: readonly QueryKey[]): string[] => keys.map((key) => hashKey(key)).toSorted()

const CHANGES: ReadonlyArray<{
  name: string
  change: (queryClient: QueryClient) => Promise<unknown>
  stale: QueryKey[]
}> = [
  {
    name: 'afterMatch',
    change: afterMatch,
    stale: [...EVERY_LIBRARY, ...ITEMS, HELD.favourites, HELD.home, HELD.media],
  },
  {
    name: 'afterLibrarySaved',
    change: afterLibrarySaved,
    stale: [...EVERY_LIBRARY, HELD.favourites, HELD.home, HELD.media],
  },
  {
    name: 'afterFavourites',
    change: afterFavourites,
    stale: [...EVERY_LIBRARY, ...ITEMS, HELD.favourites, HELD.home, HELD.media],
  },
  {
    name: 'afterWatched',
    change: afterWatched,
    stale: [...EVERY_LIBRARY, ...ITEMS, HELD.favourites, HELD.home, HELD.media],
  },
  {
    name: 'afterWatching',
    change: (queryClient) => afterWatching({ queryClient, libraryId: 2 }),
    stale: [...THE_LIBRARY, ...ITEMS, HELD.favourites, HELD.home],
  },
  { name: 'afterPins', change: afterPins, stale: [...EVERY_LIBRARY, HELD.home] },
  { name: 'afterRescan', change: afterRescan, stale: EVERY_LIBRARY },
  {
    name: 'afterRematch',
    change: (queryClient) => afterRematch({ queryClient, libraryId: 2 }),
    stale: [HELD.libraries, HELD.listing, HELD.shows, HELD.unmatched],
  },
  {
    name: 'afterLibraryView',
    change: (queryClient) => afterLibraryView({ queryClient, libraryId: 2 }),
    stale: [HELD.libraries, HELD.library],
  },
  {
    name: 'afterSagaBackdrop',
    change: (queryClient) => afterSagaBackdrop({ queryClient, libraryId: 2 }),
    stale: [HELD.sagas],
  },
  {
    name: 'afterItemEdited for its images',
    change: (queryClient) =>
      afterItemEdited({
        queryClient,
        updated: itemDetails({ id: 40 }),
        part: EDITED_PARTS.images,
      }),
    stale: [...EVERY_LIBRARY, HELD.itemImages, HELD.home],
  },
  {
    name: 'afterItemEdited for its metadata',
    change: (queryClient) =>
      afterItemEdited({
        queryClient,
        updated: itemDetails({ id: 40 }),
        part: EDITED_PARTS.metadata,
      }),
    stale: [...EVERY_LIBRARY, HELD.itemMetadata, HELD.home],
  },
  {
    name: 'afterLibraryEvent',
    change: (queryClient) => afterLibraryEvent({ queryClient, libraryId: 2 }),
    stale: [HELD.libraries, ...THE_LIBRARY, ...ITEMS, HELD.favourites, HELD.home],
  },
  {
    name: 'afterSplit',
    change: (queryClient) => afterSplit({ queryClient, libraryId: 2 }),
    stale: [...THE_LIBRARY, ...ITEMS, HELD.home],
  },
  {
    name: 'afterReconnect',
    change: afterReconnect,
    stale: [...EVERY_LIBRARY, ...ITEMS, HELD.favourites, HELD.home],
  },
  {
    name: 'afterMatchingPass',
    change: (queryClient) => afterMatchingPass({ queryClient, libraryId: 2 }),
    stale: [HELD.libraries, HELD.library, HELD.home],
  },
  {
    name: 'afterAiLookups',
    change: (queryClient) => afterAiLookups({ queryClient, libraryId: 2 }),
    stale: [HELD.libraries, ...THE_LIBRARY, HELD.home],
  },
]

describe('what each change reads again', () => {
  CHANGES.forEach(({ name, change, stale }) =>
    it(`${name} reads again only what it names`, async () => {
      expect(await readAgain(change)).toEqual(hashed(stale))
    }),
  )
})

describe('afterItemEdited', () => {
  it('hands the item page the answer without reading it again', async () => {
    const client = holding([queryKeys.item(40)])
    const updated = itemDetails({ id: 40, title: 'Busboys Redux' })
    await afterItemEdited({ queryClient: client, updated, part: EDITED_PARTS.images })
    expect(client.getQueryData<typeof updated>(queryKeys.item(40))).toEqual(updated)
    expect(client.getQueryState(queryKeys.item(40))?.isInvalidated).toBe(false)
  })
})
