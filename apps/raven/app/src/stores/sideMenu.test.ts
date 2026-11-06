import { beforeEach, describe, expect, it } from 'bun:test'
import type { StateStorage } from 'zustand/middleware'

import { SIDE_MENU_KEY, configureSideMenu, isMenuOpen, useSideMenu } from '@/stores/sideMenu'

const memoryStorage = (entries: [string, string][] = []) => {
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

describe('useSideMenu', () => {
  beforeEach(() => useSideMenu.setState({ isPinned: false, hasFocus: false }))

  it('starts folded, and keeps a pin across a relaunch', async () => {
    const { storage, items } = memoryStorage()
    await configureSideMenu({ storage })
    expect(isMenuOpen(useSideMenu.getState())).toBe(false)
    useSideMenu.getState().toggle()

    // What the next launch reads is what this one wrote, before anything here changes it.
    const relaunch = memoryStorage([...items])
    useSideMenu.setState({ isPinned: false })
    await configureSideMenu({ storage: relaunch.storage })
    expect(useSideMenu.getState().isPinned).toBe(true)
  })

  it('folds when what it kept is not a pin, and reads no older fold', async () => {
    const saved = JSON.stringify({ state: { isPinned: 'yes' }, version: 0 })
    await configureSideMenu({ storage: memoryStorage([[SIDE_MENU_KEY, saved]]).storage })
    expect(useSideMenu.getState().isPinned).toBe(false)
    const older = JSON.stringify({ state: { isCollapsed: false }, version: 0 })
    await configureSideMenu({ storage: memoryStorage([['raven-side-menu', older]]).storage })
    expect(useSideMenu.getState().isPinned).toBe(false)
  })

  it('opens while the remote is in it, and stays open moving from row to row', async () => {
    useSideMenu.getState().enter()
    expect(isMenuOpen(useSideMenu.getState())).toBe(true)
    useSideMenu.getState().leave()
    useSideMenu.getState().enter()
    await Bun.sleep(200)
    expect(isMenuOpen(useSideMenu.getState())).toBe(true)
    useSideMenu.getState().leave()
    await Bun.sleep(200)
    expect(isMenuOpen(useSideMenu.getState())).toBe(false)
  })
})
