import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { moveLegacyBinge } from '@/lib/legacyBinge'
import { fakeBinge } from '@/test/fakeBinge'
import { STORE_KEYS } from '@/stores/storage'

const save = (profiles: unknown[]) =>
  window.localStorage.setItem(STORE_KEYS.binge, JSON.stringify({ state: { profiles }, version: 0 }))

describe('moving binge shows kept in this browser to the server', () => {
  let binge = fakeBinge()
  beforeEach(() => {
    binge.restore()
    binge = fakeBinge()
    window.localStorage.removeItem(STORE_KEYS.binge)
  })
  afterEach(() => {
    binge.restore()
    window.localStorage.removeItem(STORE_KEYS.binge)
  })

  it('does nothing when the browser kept nothing for the account', async () => {
    save([{ account: 'other', ids: [1], hasSeenTip: true }])
    await moveLegacyBinge({ account: 'viewer' })
    expect(binge.set).not.toHaveBeenCalled()
    expect(binge.dismiss).not.toHaveBeenCalled()
  })

  it('adds the oldest first so the newest ends first, keeps others’ lists and the tip', async () => {
    save([
      { account: 'viewer', ids: [3, 2, 1], hasSeenTip: true },
      { account: 'other', ids: [9], hasSeenTip: false },
    ])
    await moveLegacyBinge({ account: 'viewer' })
    expect(binge.state()).toEqual({ ids: [3, 2, 1], hasSeenTip: true })
    expect(JSON.parse(window.localStorage.getItem(STORE_KEYS.binge) ?? 'null')).toEqual({
      state: { profiles: [{ account: 'other', ids: [9], hasSeenTip: false }] },
      version: 0,
    })
  })

  it('carries a dismissed tip with no shows, and clears the key once nothing is left', async () => {
    save([{ account: 'viewer', ids: [], hasSeenTip: true }])
    await moveLegacyBinge({ account: 'viewer' })
    expect(binge.state()).toEqual({ ids: [], hasSeenTip: true })
    expect(window.localStorage.getItem(STORE_KEYS.binge)).toBeNull()
  })

  it('drops a show the server refuses and goes on with the rest', async () => {
    save([{ account: 'viewer', ids: [3, 2, 1], hasSeenTip: false }])
    binge.set.mockImplementationOnce(async () => {
      throw new Error('locked')
    })
    await moveLegacyBinge({ account: 'viewer' })
    expect(binge.state().ids).toEqual([3, 2])
  })

  it('ignores a corrupt entry', async () => {
    window.localStorage.setItem(STORE_KEYS.binge, '{not json')
    await moveLegacyBinge({ account: 'viewer' })
    expect(binge.set).not.toHaveBeenCalled()
  })
})
