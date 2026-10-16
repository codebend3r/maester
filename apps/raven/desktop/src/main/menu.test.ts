import { describe, expect, it } from 'bun:test'
import { type MenuEntry, menuTemplate } from '@/main/menu'
import type { DesktopEvent } from '@/shared/protocol'

const setup = () => {
  const sent: DesktopEvent[] = []
  const dialogs = { opened: 0 }
  const template = menuTemplate({
    appName: 'raven player',
    actions: {
      openDialog: () => {
        dialogs.opened += 1
      },
      send: (event) => {
        sent.push(event)
      },
    },
  })
  return { template, sent, dialogs }
}

const everyItem = (entries: readonly MenuEntry[]): MenuEntry[] =>
  entries.flatMap((entry) => [entry, ...everyItem(entry.submenu ?? [])])

const topLevel = (template: readonly MenuEntry[], name: string): MenuEntry => {
  const found = template.find((entry) => (entry.label ?? entry.role) === name)
  if (found === undefined) throw new Error(`no ${name} menu`)
  return found
}

const click = (entry: MenuEntry): void => {
  if (entry.click === undefined) throw new Error(`${entry.label ?? 'item'} has no click`)
  entry.click()
}

const itemOf = (menu: MenuEntry, label: string): MenuEntry => {
  const found = (menu.submenu ?? []).find((entry) => entry.label === label)
  if (found === undefined) throw new Error(`no ${label} item`)
  return found
}

describe('menuTemplate', () => {
  it('lists the top menus in order', () => {
    const { template } = setup()
    expect(template.map((entry) => entry.label ?? entry.role)).toEqual([
      'raven player',
      'File',
      'Playback',
      'View',
      'Window',
      'Help',
    ])
  })

  it('opens Settings with Command comma', () => {
    const { template, sent } = setup()
    const settings = itemOf(topLevel(template, 'raven player'), 'Settings…')
    expect(settings.accelerator).toBe('CommandOrControl+,')
    click(settings)
    expect(sent).toEqual([{ type: 'navigate', to: 'settings' }])
  })

  it('keeps the standard app menu roles', () => {
    const { template } = setup()
    expect(
      (topLevel(template, 'raven player').submenu ?? []).map(
        (entry) => entry.role ?? entry.type ?? entry.label,
      ),
    ).toEqual([
      'about',
      'separator',
      'Settings…',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ])
  })

  it('opens the dialog from Open… with Command O', () => {
    const { template, dialogs } = setup()
    const open = itemOf(topLevel(template, 'File'), 'Open…')
    expect(open.accelerator).toBe('CommandOrControl+O')
    click(open)
    expect(dialogs.opened).toBe(1)
  })

  it('gives Open Recent the native list and its Clear Menu', () => {
    const { template } = setup()
    const recent = itemOf(topLevel(template, 'File'), 'Open Recent')
    expect(recent.role).toBe('recentDocuments')
    expect((recent.submenu ?? []).map((entry) => entry.role)).toEqual(['clearRecentDocuments'])
  })

  it('ends the File menu with Close Window', () => {
    const { template } = setup()
    expect((topLevel(template, 'File').submenu ?? []).at(-1)?.role ?? null).toBe('close')
  })

  it('sends each Playback item as a player action, with no accelerators', () => {
    const { template, sent } = setup()
    const playback = topLevel(template, 'Playback')
    expect(
      everyItem(playback.submenu ?? []).filter((entry) => entry.accelerator !== undefined),
    ).toEqual([])
    ;(playback.submenu ?? []).forEach(click)
    expect(sent).toEqual([
      { type: 'player', action: 'togglePlay' },
      { type: 'player', action: 'skipBack' },
      { type: 'player', action: 'skipForward' },
      { type: 'player', action: 'next' },
    ])
  })

  it('sends skipForward from Skip Forward', () => {
    const { template, sent } = setup()
    click(itemOf(topLevel(template, 'Playback'), 'Skip Forward'))
    expect(sent).toEqual([{ type: 'player', action: 'skipForward' }])
  })

  it('puts full screen under View and the standard window menu under Window', () => {
    const { template } = setup()
    expect((topLevel(template, 'View').submenu ?? []).map((entry) => entry.role)).toEqual([
      'togglefullscreen',
    ])
    expect(topLevel(template, 'Window').role).toBe('windowMenu')
  })

  it('shows the keyboard shortcuts from Help', () => {
    const { template, sent } = setup()
    const help = topLevel(template, 'Help')
    expect(help.role).toBe('help')
    click(itemOf(help, 'Keyboard Shortcuts'))
    expect(sent).toEqual([{ type: 'player', action: 'showShortcuts' }])
  })

  it('binds no single key, so the page keeps them', () => {
    const { template } = setup()
    const accelerators = everyItem(template).flatMap((entry) =>
      typeof entry.accelerator === 'string' ? [entry.accelerator] : [],
    )
    expect(accelerators.length).toBeGreaterThan(0)
    accelerators.forEach((accelerator) => {
      expect(accelerator).toMatch(/Command|Control|CommandOrControl/)
    })
  })

  it('leaves out the items later steps add', () => {
    const { template } = setup()
    const labels = everyItem(template).map((entry) => entry.label)
    ;[
      'Check for Updates',
      'Check for Updates…',
      'Open Link',
      'Open Link…',
      'Video Info',
      'Show Logs',
      'Show Crash Reports',
      'Copy Diagnostics',
    ].forEach((label) => {
      expect(labels).not.toContain(label)
    })
  })
})
