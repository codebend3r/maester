import { afterEach, describe, expect, it } from 'bun:test'
import { useSideMenu } from '@/stores/sideMenu'
import { STORE_KEYS } from '@/stores/storage'

const initial = useSideMenu.getInitialState()

afterEach(() => {
  window.localStorage.clear()
  useSideMenu.setState(initial, true)
})

describe('useSideMenu', () => {
  it('starts with Manage closed', () => {
    expect(useSideMenu.getState().isManageOpen).toBe(false)
  })

  it('keeps Manage closed for a browser that saved the old open default', async () => {
    window.localStorage.setItem(
      STORE_KEYS.sideMenu,
      JSON.stringify({
        state: { collapsed: true, tipSeen: true, isManageFolded: false },
        version: 0,
      }),
    )
    await useSideMenu.persist.rehydrate()
    expect(useSideMenu.getState().isManageOpen).toBe(false)
    expect(useSideMenu.getState().collapsed).toBe(true)
    expect(useSideMenu.getState().tipSeen).toBe(true)
  })

  it('remembers Manage once it is opened', async () => {
    useSideMenu.getState().toggleManage()
    const saved = window.localStorage.getItem(STORE_KEYS.sideMenu) ?? ''
    useSideMenu.setState(initial, true)
    window.localStorage.setItem(STORE_KEYS.sideMenu, saved)
    await useSideMenu.persist.rehydrate()
    expect(useSideMenu.getState().isManageOpen).toBe(true)
  })
})
