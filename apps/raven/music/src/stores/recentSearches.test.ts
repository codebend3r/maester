import { beforeEach, describe, expect, it } from 'bun:test'
import type { StateStorage } from 'zustand/middleware'

import {
  RECENT_KINDS,
  RECENT_SEARCHES_KEPT,
  RECENT_SEARCHES_KEY,
  type RecentSearch,
  configureRecentSearches,
  recentKeyOf,
  recentSearchesOf,
  useRecentSearches,
  withRecent,
} from '@/stores/recentSearches'

type MemoryStorageProps = { entries?: [string, string][] }

const memoryStorage = ({ entries = [] }: MemoryStorageProps = {}) => {
  const items = new Map(entries)
  const storage: StateStorage = {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value)
    },
    removeItem: (name) => {
      items.delete(name)
    },
  }
  return { storage, items }
}

const LOVE: RecentSearch = { kind: RECENT_KINDS.query, text: 'love' }
const SIA: RecentSearch = { kind: RECENT_KINDS.artist, id: 3, name: 'Sia' }
const DOO_WOPS: RecentSearch = {
  kind: RECENT_KINDS.album,
  id: 9,
  title: 'Doo-Wops & Hooligans',
  artists: 'Bruno Mars',
}

describe('withRecent', () => {
  it('puts the newest first and moves a search made again to the top', () => {
    const recents = withRecent({ recents: [SIA, LOVE], recent: DOO_WOPS })
    expect(recents).toEqual([DOO_WOPS, SIA, LOVE])
    expect(withRecent({ recents, recent: { ...LOVE, text: 'LOVE' } })).toEqual([
      { ...LOVE, text: 'LOVE' },
      DOO_WOPS,
      SIA,
    ])
  })

  it(`keeps at most ${RECENT_SEARCHES_KEPT}`, () => {
    const many = Array.from({ length: RECENT_SEARCHES_KEPT + 3 }, (_, id) => ({
      kind: RECENT_KINDS.artist,
      id,
      name: `Artist ${id}`,
    }))
    const recents = many.reduce<RecentSearch[]>(
      (kept, recent) => withRecent({ recents: kept, recent }),
      [],
    )
    expect(recents).toHaveLength(RECENT_SEARCHES_KEPT)
    expect(recents[0]).toEqual(many.at(-1) ?? SIA)
  })
})

describe('recentSearchesOf', () => {
  it('keeps what is a recent search and drops the rest', () => {
    expect(
      recentSearchesOf({
        recents: [LOVE, { kind: 'song', id: 1 }, { kind: RECENT_KINDS.album, id: 'x' }, SIA, 7],
      }),
    ).toEqual([LOVE, SIA])
    expect(recentSearchesOf(null)).toEqual([])
    expect(recentSearchesOf({ recents: 'love' })).toEqual([])
  })
})

describe('useRecentSearches', () => {
  beforeEach(() => useRecentSearches.setState({ recents: [] }))

  it('remembers, forgets and clears, leaving out a blank search', () => {
    const { remember, forget, clear } = useRecentSearches.getState()
    remember(LOVE)
    remember(SIA)
    remember({ kind: RECENT_KINDS.query, text: '  ' })
    expect(useRecentSearches.getState().recents).toEqual([SIA, LOVE])
    forget(recentKeyOf(SIA))
    expect(useRecentSearches.getState().recents).toEqual([LOVE])
    clear()
    expect(useRecentSearches.getState().recents).toEqual([])
  })

  it('keeps them across a relaunch, under its key', async () => {
    const { storage, items } = memoryStorage({
      entries: [[RECENT_SEARCHES_KEY, JSON.stringify({ state: { recents: [SIA] }, version: 0 })]],
    })
    useRecentSearches.getState().remember(LOVE)
    await configureRecentSearches({ storage })
    expect(useRecentSearches.getState().recents).toEqual([LOVE, SIA])
    useRecentSearches.getState().remember(DOO_WOPS)
    expect(JSON.parse(items.get(RECENT_SEARCHES_KEY) ?? '{}').state.recents).toEqual([
      DOO_WOPS,
      LOVE,
      SIA,
    ])
  })
})
