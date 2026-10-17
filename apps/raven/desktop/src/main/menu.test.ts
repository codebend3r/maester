import { describe, expect, it } from 'bun:test'
import { type MenuEntry, menuTemplate } from '@/main/menu'
import type { DesktopEvent } from '@/shared/protocol'

const setup = ({ isDevelopment = false }: { isDevelopment?: boolean } = {}) => {
  const sent: DesktopEvent[] = []
  const dialogs = { opened: 0 }
  const devTools = { toggles: 0 }
  const help = { showLogs: 0, showCrashReports: 0, copyDiagnostics: 0 }
  const updates = { checks: 0 }
  const template = menuTemplate({
    appName: 'raven player',
    isDevelopment,
    actions: {
      openDialog: () => {
        dialogs.opened += 1
      },
      send: (event) => {
        sent.push(event)
      },
      toggleDevTools: () => {
        devTools.toggles += 1
      },
      showLogs: () => {
        help.showLogs += 1
      },
      showCrashReports: () => {
        help.showCrashReports += 1
      },
      copyDiagnostics: () => {
        help.copyDiagnostics += 1
      },
      checkForUpdates: () => {
        updates.checks += 1
      },
    },
  })
  return { template, sent, dialogs, devTools, help, updates }
}

const everyItem = (entries: readonly MenuEntry[]): MenuEntry[] =>
  entries.flatMap((entry) => [entry, ...everyItem(entry.submenu ?? [])])

const topLevel = ({
  template,
  name,
}: {
  template: readonly MenuEntry[]
  name: string
}): MenuEntry => {
  const found = template.find((entry) => (entry.label ?? entry.role) === name)
  if (found === undefined) throw new Error(`no ${name} menu`)
  return found
}

const click = (entry: MenuEntry): void => {
  if (entry.click === undefined) throw new Error(`${entry.label ?? 'item'} has no click`)
  entry.click()
}

const itemOf = ({ menu, label }: { menu: MenuEntry; label: string }): MenuEntry => {
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
    const settings = itemOf({
      menu: topLevel({ template, name: 'raven player' }),
      label: 'Settings…',
    })
    expect(settings.accelerator).toBe('CommandOrControl+,')
    click(settings)
    expect(sent).toEqual([{ type: 'navigate', to: 'settings' }])
  })

  it('keeps the standard app menu roles', () => {
    const { template } = setup()
    expect(
      (topLevel({ template, name: 'raven player' }).submenu ?? []).map(
        (entry) => entry.role ?? entry.type ?? entry.label,
      ),
    ).toEqual([
      'about',
      'separator',
      'Settings…',
      'Check for Updates…',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ])
  })

  it('checks for updates from the app menu, with no accelerator', () => {
    const { template, updates, sent } = setup()
    const check = itemOf({
      menu: topLevel({ template, name: 'raven player' }),
      label: 'Check for Updates…',
    })
    expect(check.id).toBe('check-for-updates')
    expect(check.accelerator).toBeUndefined()
    click(check)
    expect(updates.checks).toBe(1)
    expect(sent).toEqual([])
  })

  it('opens the dialog from Open… with Command O', () => {
    const { template, dialogs } = setup()
    const open = itemOf({ menu: topLevel({ template, name: 'File' }), label: 'Open…' })
    expect(open.accelerator).toBe('CommandOrControl+O')
    click(open)
    expect(dialogs.opened).toBe(1)
  })

  it('gives Open Recent the native list and its Clear Menu', () => {
    const { template } = setup()
    const recent = itemOf({ menu: topLevel({ template, name: 'File' }), label: 'Open Recent' })
    expect(recent.role).toBe('recentDocuments')
    expect((recent.submenu ?? []).map((entry) => entry.role)).toEqual(['clearRecentDocuments'])
  })

  it('opens a link from Open Link… with Command L, just after Open Recent', () => {
    const { template, sent } = setup()
    const file = topLevel({ template, name: 'File' })
    const labels = (file.submenu ?? []).map((entry) => entry.label ?? entry.role ?? entry.type)
    expect(labels.indexOf('Open Link…')).toBe(labels.indexOf('Open Recent') + 1)
    const openLink = itemOf({ menu: file, label: 'Open Link…' })
    expect(openLink.accelerator).toBe('CommandOrControl+L')
    click(openLink)
    expect(sent).toEqual([{ type: 'openLink' }])
  })

  it('ends the File menu with Close Window', () => {
    const { template } = setup()
    expect((topLevel({ template, name: 'File' }).submenu ?? []).at(-1)?.role ?? null).toBe('close')
  })

  it('sends each Playback item as a player action, with no accelerators', () => {
    const { template, sent } = setup()
    const playback = topLevel({ template, name: 'Playback' })
    expect(
      everyItem(playback.submenu ?? []).filter((entry) => entry.accelerator !== undefined),
    ).toEqual([])
    ;(playback.submenu ?? []).forEach(click)
    expect(sent).toEqual([
      { type: 'player', action: 'togglePlay' },
      { type: 'player', action: 'skipBack' },
      { type: 'player', action: 'skipForward' },
      { type: 'player', action: 'next' },
      { type: 'player', action: 'stats' },
    ])
  })

  it('lists the Playback items in order', () => {
    const { template } = setup()
    expect(
      (topLevel({ template, name: 'Playback' }).submenu ?? []).map((entry) => entry.label),
    ).toEqual(['Play or Pause', 'Skip Back', 'Skip Forward', 'Next', 'Video Info'])
  })

  it('sends stats from Video Info', () => {
    const { template, sent } = setup()
    click(itemOf({ menu: topLevel({ template, name: 'Playback' }), label: 'Video Info' }))
    expect(sent).toEqual([{ type: 'player', action: 'stats' }])
  })

  it('has no developer tools item when packaged', () => {
    const { template } = setup({ isDevelopment: false })
    expect(everyItem(template).map((entry) => entry.label)).not.toContain('Toggle Developer Tools')
  })

  it('adds Toggle Developer Tools to View when unpackaged', () => {
    const { template, devTools } = setup({ isDevelopment: true })
    const view = topLevel({ template, name: 'View' })
    expect((view.submenu ?? []).map((entry) => entry.role ?? entry.type ?? entry.label)).toEqual([
      'togglefullscreen',
      'separator',
      'Toggle Developer Tools',
    ])
    const tools = itemOf({ menu: view, label: 'Toggle Developer Tools' })
    expect(tools.accelerator).toBe('Alt+CommandOrControl+I')
    click(tools)
    expect(devTools.toggles).toBe(1)
  })

  it('sends skipForward from Skip Forward', () => {
    const { template, sent } = setup()
    click(itemOf({ menu: topLevel({ template, name: 'Playback' }), label: 'Skip Forward' }))
    expect(sent).toEqual([{ type: 'player', action: 'skipForward' }])
  })

  it('puts full screen under View and the standard window menu under Window', () => {
    const { template } = setup()
    expect((topLevel({ template, name: 'View' }).submenu ?? []).map((entry) => entry.role)).toEqual(
      ['togglefullscreen'],
    )
    expect(topLevel({ template, name: 'Window' }).role).toBe('windowMenu')
  })

  it('shows the keyboard shortcuts from Help', () => {
    const { template, sent } = setup()
    const help = topLevel({ template, name: 'Help' })
    expect(help.role).toBe('help')
    click(itemOf({ menu: help, label: 'Keyboard Shortcuts' }))
    expect(sent).toEqual([{ type: 'player', action: 'showShortcuts' }])
  })

  it('binds no single key, so the page keeps them', () => {
    const { template } = setup({ isDevelopment: true })
    const accelerators = everyItem(template).flatMap((entry) =>
      typeof entry.accelerator === 'string' ? [entry.accelerator] : [],
    )
    expect(accelerators.length).toBeGreaterThan(0)
    accelerators.forEach((accelerator) => {
      expect(accelerator).toMatch(/Command|Control|CommandOrControl/)
    })
  })

  it('ends Help with the logs, the crash reports and the diagnostics', () => {
    const { template, help } = setup()
    const menu = topLevel({ template, name: 'Help' })
    expect(
      (menu.submenu ?? []).map((entry) => ({
        label: entry.label ?? entry.type,
        id: entry.id ?? null,
        accelerator: entry.accelerator ?? null,
      })),
    ).toEqual([
      { label: 'Keyboard Shortcuts', id: null, accelerator: null },
      { label: 'separator', id: null, accelerator: null },
      { label: 'Show Logs', id: 'show-logs', accelerator: null },
      { label: 'Show Crash Reports', id: 'show-crash-reports', accelerator: null },
      { label: 'Copy Diagnostics', id: 'copy-diagnostics', accelerator: null },
    ])
    click(itemOf({ menu, label: 'Show Logs' }))
    expect(help).toEqual({ showLogs: 1, showCrashReports: 0, copyDiagnostics: 0 })
    click(itemOf({ menu, label: 'Show Crash Reports' }))
    expect(help).toEqual({ showLogs: 1, showCrashReports: 1, copyDiagnostics: 0 })
    click(itemOf({ menu, label: 'Copy Diagnostics' }))
    expect(help).toEqual({ showLogs: 1, showCrashReports: 1, copyDiagnostics: 1 })
  })
})
