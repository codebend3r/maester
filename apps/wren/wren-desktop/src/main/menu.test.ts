import { describe, expect, it, mock } from 'bun:test'
import type { MenuItemConstructorOptions } from 'electron'
import { DESKTOP_COPY } from '@/main/copy'
import { menuTemplate } from '@/main/menu'

const ROLES = { devTools: 'toggleDevTools', edit: 'editMenu' } as const

const submenuOf = (menu: MenuItemConstructorOptions): MenuItemConstructorOptions[] =>
  Array.isArray(menu.submenu) ? menu.submenu : []

const itemsOf = (template: readonly MenuItemConstructorOptions[]) =>
  template.flatMap((menu) => submenuOf(menu))

describe('menuTemplate', () => {
  it('offers the developer tools only to an unpackaged run', () => {
    const props = { showWindow: mock(), openWebSite: mock() }
    const hasDevTools = (isPackaged: boolean) =>
      itemsOf(menuTemplate({ ...props, isPackaged })).some(({ role }) => role === ROLES.devTools)
    expect(hasDevTools(false)).toBe(true)
    expect(hasDevTools(true)).toBe(false)
  })

  it('keeps the standard Edit menu, so a password can be pasted', () => {
    const template = menuTemplate({ isPackaged: true, showWindow: mock(), openWebSite: mock() })
    expect(template.some(({ role }) => role === ROLES.edit)).toBe(true)
  })

  it('brings the window back, and opens Wren on the web, from their items', () => {
    const showWindow = mock()
    const openWebSite = mock()
    const items = itemsOf(menuTemplate({ isPackaged: true, showWindow, openWebSite }))
    const clickOf = (label: string) => items.find((entry) => entry.label === label)?.click
    expect(clickOf(DESKTOP_COPY.menu.showWindow)).toBe(showWindow)
    expect(clickOf(DESKTOP_COPY.menu.webSite)).toBe(openWebSite)
  })
})
