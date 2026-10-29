import { beforeEach, describe, expect, it } from 'bun:test'
import type { StateStorage } from 'zustand/middleware'

import { SIDE_MENU_KEY, configureSideMenu, useSideMenu } from '@/stores/sideMenu'

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
  beforeEach(() => useSideMenu.setState({ isCollapsed: false }))

  it('starts open, and keeps a fold across a relaunch', async () => {
    const { storage, items } = memoryStorage()
    await configureSideMenu({ storage })
    expect(useSideMenu.getState().isCollapsed).toBe(false)
    useSideMenu.getState().toggle()

    // What the next launch reads is what this one wrote, before anything here changes it.
    const relaunch = memoryStorage([...items])
    useSideMenu.setState({ isCollapsed: false })
    await configureSideMenu({ storage: relaunch.storage })
    expect(useSideMenu.getState().isCollapsed).toBe(true)
  })

  it('opens when what it kept is not a fold', async () => {
    const saved = JSON.stringify({ state: { isCollapsed: 'yes' }, version: 0 })
    await configureSideMenu({ storage: memoryStorage([[SIDE_MENU_KEY, saved]]).storage })
    expect(useSideMenu.getState().isCollapsed).toBe(false)
  })
})
