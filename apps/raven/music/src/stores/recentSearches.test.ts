import { beforeEach, describe, expect, it } from 'bun:test'
import { RECENT_KINDS, RECENT_SEARCHES_KEY, type RecentSearch, recentKeyOf } from '@raven/wren'
import type { StateStorage } from 'zustand/middleware'

import { configureRecentSearches, useRecentSearches } from '@/stores/recentSearches'

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
