import { describe, expect, it } from 'bun:test'
import { RECENT_KINDS, RECENT_SEARCHES_KEY, type RecentSearch, recentKeyOf } from '@raven/wren'
import { useRecentSearches } from '@/stores/recentSearches'

const LOVE: RecentSearch = { kind: RECENT_KINDS.query, text: 'love' }
const SIA: RecentSearch = { kind: RECENT_KINDS.artist, id: 3, name: 'Sia' }
const DOO_WOPS: RecentSearch = {
  kind: RECENT_KINDS.album,
  id: 9,
  title: 'Doo-Wops & Hooligans',
  artists: 'Bruno Mars',
}

const keep = (recents: unknown): void =>
  window.localStorage.setItem(
    RECENT_SEARCHES_KEY,
    JSON.stringify({ state: { recents }, version: 0 }),
  )

const kept = (): unknown =>
  JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '{}').state?.recents ?? null

describe('useRecentSearches', () => {
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

  it('keeps them across a visit, under the key the apps use, what was just searched on top', async () => {
    useRecentSearches.setState({ recents: [LOVE] })
    keep([SIA])
    await useRecentSearches.persist.rehydrate()
    expect(useRecentSearches.getState().recents).toEqual([LOVE, SIA])

    useRecentSearches.getState().remember(DOO_WOPS)
    expect(kept()).toEqual([DOO_WOPS, LOVE, SIA])
  })

  it('reads back only what is a recent search, so a value it does not know is dropped', async () => {
    keep([SIA, { kind: 'mystery' }, 'nonsense'])
    await useRecentSearches.persist.rehydrate()

    expect(useRecentSearches.getState().recents).toEqual([SIA])
  })
})
