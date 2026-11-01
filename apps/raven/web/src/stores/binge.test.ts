import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES } from '@raven/core'
import { followBinge, useBinge } from '@/stores/binge'
import { STORE_KEYS } from '@/stores/storage'

const mark = (id: number) =>
  useBinge.getState().toggle({ account: 'viewer', item: { id, type: ITEM_TYPES.show } })

describe('binge selections', () => {
  it('keeps the newest first, caps at three, and allows removal at the limit', () => {
    ;[1, 2, 3, 4].forEach(mark)
    expect(useBinge.getState().profiles[0]?.ids).toEqual([3, 2, 1])
    mark(2)
    mark(4)
    expect(useBinge.getState().profiles[0]?.ids).toEqual([4, 3, 1])
    expect(useBinge.getState().profiles[0]?.hasSeenTip).toBe(true)
  })

  it('rejects movies, seasons, episodes, and invalid ids', () => {
    ;[ITEM_TYPES.movie, ITEM_TYPES.season, ITEM_TYPES.episode].forEach((type) =>
      useBinge.getState().toggle({ account: 'viewer', item: { id: 1, type } }),
    )
    ;[0, -1, NaN, 1.5].forEach(mark)
    expect(useBinge.getState().profiles).toEqual([])
  })

  it('keeps accounts and their first-use dismissal separate', () => {
    mark(1)
    useBinge.getState().dismissTip('other')
    useBinge.getState().dismissTip('viewer')
    expect(useBinge.getState().profiles).toEqual([
      { account: 'other', ids: [], hasSeenTip: true },
      { account: 'viewer', ids: [1], hasSeenTip: true },
    ])
    useBinge.getState().toggle({ account: 'other', item: { id: 2, type: ITEM_TYPES.show } })
    expect(
      useBinge.getState().profiles.find((profile) => profile.account === 'viewer')?.ids,
    ).toEqual([1])
  })

  it('persists selections and the tip across reloads', async () => {
    mark(1)
    const saved = window.localStorage.getItem(STORE_KEYS.binge)
    useBinge.setState({ profiles: [] })
    window.localStorage.setItem(STORE_KEYS.binge, saved ?? '')
    await useBinge.persist.rehydrate()
    expect(useBinge.getState().profiles[0]).toEqual({
      account: 'viewer',
      ids: [1],
      hasSeenTip: true,
    })
  })

  it('reconciles stale tab snapshots before adding a show or dismissing the tip', () => {
    mark(1)
    useBinge.getState().dismissTip('other')
    const latest = window.localStorage.getItem(STORE_KEYS.binge) ?? ''
    useBinge.setState({ profiles: [] })
    window.localStorage.setItem(STORE_KEYS.binge, latest)
    mark(2)
    expect(
      useBinge.getState().profiles.find((profile) => profile.account === 'viewer')?.ids,
    ).toEqual([2, 1])
    expect(
      useBinge.getState().profiles.find((profile) => profile.account === 'other')?.hasSeenTip,
    ).toBe(true)
    const afterMark = window.localStorage.getItem(STORE_KEYS.binge) ?? ''
    useBinge.setState({ profiles: [] })
    window.localStorage.setItem(STORE_KEYS.binge, afterMark)
    useBinge.getState().dismissTip('viewer')
    expect(
      useBinge.getState().profiles.find((profile) => profile.account === 'viewer')?.ids,
    ).toEqual([2, 1])
  })

  it('follows changes and clearing from another tab and stops listening on cleanup', () => {
    const stop = followBinge()
    const profile = { account: 'viewer', ids: [4], hasSeenTip: true }
    window.localStorage.setItem(
      STORE_KEYS.binge,
      JSON.stringify({ state: { profiles: [profile] }, version: 0 }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(useBinge.getState().profiles).toEqual([])
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEYS.binge }))
    expect(useBinge.getState().profiles).toEqual([profile])
    window.localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(useBinge.getState().profiles).toEqual([])
    stop()
    window.localStorage.setItem(
      STORE_KEYS.binge,
      JSON.stringify({ state: { profiles: [profile] }, version: 0 }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEYS.binge }))
    expect(useBinge.getState().profiles).toEqual([])
  })

  it('validates stored profiles rather than trusting browser storage', async () => {
    const invalid = [
      null,
      {},
      { profiles: null },
      {
        profiles: [
          null,
          {},
          { account: 1, ids: [], hasSeenTip: true },
          { account: 'v', ids: [], hasSeenTip: 1 },
          { account: 'v', ids: [1, 2, 3, 4], hasSeenTip: true },
          { account: 'v', ids: [1, 1], hasSeenTip: true },
          { account: 'v', ids: ['1'], hasSeenTip: true },
        ],
      },
    ]
    await Promise.all(
      invalid.map(async (state) => {
        window.localStorage.setItem(STORE_KEYS.binge, JSON.stringify({ state, version: 0 }))
        await useBinge.persist.rehydrate()
        expect(useBinge.getState().profiles).toEqual([])
      }),
    )
  })
})
