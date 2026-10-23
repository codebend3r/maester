import { describe, expect, it } from 'bun:test'
import type { DesktopConfig, UpdateSettings } from '@/main/desktopConfig'
import { SERVER, configFor } from '@/main/test/configFakes'
import { createJsonStore, type StateFs } from '@/main/stateStore'
import { fakeTimers } from '@/main/test/playerFakes'
import {
  createMenuCheck,
  createUpdateService,
  UPDATE_COPY,
  type UpdateDialogOptions,
  updateDialogFor,
  updateSourceFrom,
} from '@/main/updateService'
import {
  checkForUpdates,
  dmgNameFor,
  RELEASES_URL,
  UPDATE_PROBLEMS,
  type UpdateCheck,
  type UpdateFetch,
} from '@/main/updates'

const EMPTY_CONFIG = configFor(SERVER)
const FILE = '/data/desktop-config.json'
const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const CURRENT = '0.5.4'
const PAGE = 'https://github.com/codebend3r/maester/releases/tag/v0.6.0'

const NEWER: UpdateCheck = {
  ok: true,
  finding: { kind: 'newer', version: '0.6.0', pageUrl: PAGE },
}
const UP_TO_DATE: UpdateCheck = { ok: true, finding: { kind: 'current' } }
const UNREACHABLE: UpdateCheck = { ok: false, problem: UPDATE_PROBLEMS.unreachable }
const UNLISTED: UpdateCheck = { ok: false, problem: UPDATE_PROBLEMS.unlisted }

/** A file system in memory. */
const fakeFs = () => {
  const files = new Map<string, string>()
  const fs: StateFs = {
    readFile: async (path) => files.get(path) ?? '',
    writeFile: async ({ path, data }) => {
      files.set(path, data)
    },
    rename: async ({ from, to }) => {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    },
  }
  return { fs, files }
}

const setup = ({
  updates = { isEnabled: true, checkedAt: null },
  answers = [NEWER],
  isBrowserBroken = false,
  check,
}: {
  updates?: UpdateSettings
  answers?: UpdateCheck[]
  isBrowserBroken?: boolean
  check?: () => Promise<UpdateCheck>
} = {}) => {
  const disk = fakeFs()
  const clock = fakeTimers()
  const initial: DesktopConfig = { ...EMPTY_CONFIG, updates }
  const config = createJsonStore({
    fs: disk.fs,
    file: FILE,
    initial,
    timers: clock.timers,
    debounceMs: 0,
    onError: (error) => {
      throw error
    },
  })
  const queue = [...answers]
  const checks = { n: 0 }
  const announced: string[] = []
  const opened: string[] = []
  const warnings: string[] = []
  const service = createUpdateService({
    config,
    check: async () => {
      checks.n += 1
      return check === undefined ? (queue.shift() ?? UP_TO_DATE) : check()
    },
    current: CURRENT,
    now: () => NOW,
    openExternal: async (url) => {
      opened.push(url)
      if (isBrowserBroken) throw new Error('no browser')
    },
    announce: (version) => {
      announced.push(version)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  const saved = async (): Promise<unknown> => {
    await config.flush()
    return JSON.parse(disk.files.get(FILE) ?? 'null')
  }
  return { service, config, checks, announced, opened, warnings, saved }
}

describe('atLaunch', () => {
  it('checks once when it never has, stores when, and announces a newer release', async () => {
    const { service, config, checks, announced } = setup()
    await service.atLaunch()
    expect(checks.n).toBe(1)
    expect(config.read().updates).toEqual({ isEnabled: true, checkedAt: NOW })
    expect(announced).toEqual(['0.6.0'])
    expect(service.status()).toEqual({
      isEnabled: true,
      current: CURRENT,
      checkedAt: NOW,
      latest: '0.6.0',
      problem: null,
    })
  })

  it('neither checks nor announces when the last check was an hour ago', async () => {
    const { service, checks, announced } = setup({
      updates: { isEnabled: true, checkedAt: NOW - HOUR },
    })
    await service.atLaunch()
    expect(checks.n).toBe(0)
    expect(announced).toEqual([])
  })

  it('announces nothing when the newest release is the running one', async () => {
    const { service, checks, announced } = setup({ answers: [UP_TO_DATE] })
    await service.atLaunch()
    expect(checks.n).toBe(1)
    expect(announced).toEqual([])
    expect(service.status().latest).toBeNull()
  })

  it('never checks when switched off, while the menu check still does', async () => {
    const { service, checks, announced } = setup({
      updates: { isEnabled: false, checkedAt: null },
    })
    await service.atLaunch()
    expect(checks.n).toBe(0)
    expect(announced).toEqual([])
    expect(await service.checkNow()).toEqual(NEWER)
    expect(checks.n).toBe(1)
    expect(service.status().latest).toBe('0.6.0')
  })
})

describe('checkNow', () => {
  it('stores when it checked and the problem when GitHub fails, and warns once', async () => {
    const { service, config, warnings } = setup({ answers: [UNREACHABLE] })
    expect(await service.checkNow()).toEqual(UNREACHABLE)
    expect(config.read().updates.checkedAt).toBe(NOW)
    expect(service.status()).toEqual({
      isEnabled: true,
      current: CURRENT,
      checkedAt: NOW,
      latest: null,
      problem: UPDATE_PROBLEMS.unreachable,
    })
    expect(warnings).toEqual([`Raven could not check for updates: ${UPDATE_PROBLEMS.unreachable}`])
  })

  it('keeps a newer release through a failure, and a current answer clears both', async () => {
    const { service } = setup({ answers: [NEWER, UNREACHABLE, UP_TO_DATE] })
    await service.checkNow()
    await service.checkNow()
    expect(service.status()).toMatchObject({
      latest: '0.6.0',
      problem: UPDATE_PROBLEMS.unreachable,
    })
    await service.checkNow()
    expect(service.status()).toMatchObject({ latest: null, problem: null })
  })

  it('shares one check between two calls at once', async () => {
    const { service, checks } = setup()
    const [first, second] = await Promise.all([service.checkNow(), service.checkNow()])
    expect(checks.n).toBe(1)
    expect(first).toEqual(NEWER)
    expect(second).toEqual(NEWER)
    await service.checkNow()
    expect(checks.n).toBe(2)
  })

  it('treats a check that rejects as GitHub not answering', async () => {
    const disk = fakeFs()
    const config = createJsonStore({
      fs: disk.fs,
      file: FILE,
      initial: EMPTY_CONFIG,
      timers: fakeTimers().timers,
      debounceMs: 0,
      onError: () => undefined,
    })
    const warnings: string[] = []
    const service = createUpdateService({
      config,
      check: () => Promise.reject(new Error('boom')),
      current: CURRENT,
      now: () => NOW,
      openExternal: async () => undefined,
      announce: () => undefined,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(await service.checkNow()).toEqual(UNREACHABLE)
    expect(config.read().updates.checkedAt).toBe(NOW)
    expect(warnings).toHaveLength(1)
  })
})

describe('a list with no Raven release in it', () => {
  // GitHub as it answers when build releases fill the page: none of them carries the app.
  const onlyBuilds: UpdateFetch = async () => ({
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify(
        Array.from({ length: 30 }, (_, index) => ({
          tag_name: `v${CURRENT}.${30 - index}`,
          draft: false,
          prerelease: false,
          assets: [],
        })),
      ),
  })

  it('stores the problem, claims nothing found, announces nothing and warns', async () => {
    const { service, announced, warnings } = setup({
      check: () => checkForUpdates({ fetch: onlyBuilds, url: RELEASES_URL, current: CURRENT }),
    })
    await service.atLaunch()
    expect(announced).toEqual([])
    expect(service.status()).toEqual({
      isEnabled: true,
      current: CURRENT,
      checkedAt: NOW,
      latest: null,
      problem: 'GitHub listed no Raven release.',
    })
    expect(warnings).toEqual(['Raven could not check for updates: GitHub listed no Raven release.'])
  })

  it('tells the menu it could not check, never that this is the newest', async () => {
    const { service } = setup({
      check: () => checkForUpdates({ fetch: onlyBuilds, url: RELEASES_URL, current: CURRENT }),
    })
    const dialog = updateDialogFor({ check: await service.checkNow(), current: CURRENT })
    expect(dialog).toMatchObject({
      type: 'warning',
      message: 'Raven could not check for updates.',
      detail: 'GitHub listed no Raven release.',
      opensRelease: false,
    })
    expect(dialog.message).not.toContain('newest')
  })

  it('keeps a newer release an earlier check found', async () => {
    const { service } = setup({ answers: [NEWER, UNLISTED] })
    await service.checkNow()
    await service.checkNow()
    expect(service.status()).toMatchObject({
      latest: '0.6.0',
      problem: UPDATE_PROBLEMS.unlisted,
    })
  })

  it('still finds the release behind a page of builds', async () => {
    const PAGE_2 = 'https://api.github.com/repositories/1388607730/releases?per_page=100&page=2'
    const paged: UpdateFetch = async ({ url }) => {
      if (url === PAGE_2) {
        return {
          status: 200,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify([
              {
                tag_name: 'v0.6.0',
                draft: false,
                prerelease: false,
                assets: [{ name: dmgNameFor('0.6.0') }],
              },
            ]),
        }
      }
      const response = await onlyBuilds({
        url,
        init: { headers: {}, signal: AbortSignal.timeout(1000) },
      })
      return { ...response, headers: { get: () => `<${PAGE_2}>; rel="next"` } }
    }
    const { service, announced } = setup({
      check: () => checkForUpdates({ fetch: paged, url: RELEASES_URL, current: CURRENT }),
    })
    await service.atLaunch()
    expect(announced).toEqual(['0.6.0'])
    expect(service.status()).toMatchObject({ latest: '0.6.0', problem: null })
  })
})

describe('openRelease', () => {
  it('opens nothing and says false before a newer release is found', async () => {
    const { service, opened } = setup()
    expect(await service.openRelease()).toBe(false)
    expect(opened).toEqual([])
  })

  it("opens the page built from the newer release's tag", async () => {
    const { service, opened } = setup()
    await service.checkNow()
    expect(await service.openRelease()).toBe(true)
    expect(opened).toEqual([PAGE])
  })

  it('warns and says false when the browser cannot be opened', async () => {
    const { service, warnings } = setup({ isBrowserBroken: true })
    await service.checkNow()
    expect(await service.openRelease()).toBe(false)
    expect(warnings).toEqual(['Raven could not open the release page: no browser'])
  })
})

describe('setEnabled', () => {
  it('stores the switch, keeps when it last checked, and answers the new status', async () => {
    const { service, saved } = setup({ updates: { isEnabled: true, checkedAt: NOW - HOUR } })
    expect(service.setEnabled(false).isEnabled).toBe(false)
    expect(service.status().isEnabled).toBe(false)
    expect(await saved()).toMatchObject({
      version: 5,
      updates: { isEnabled: false, checkedAt: NOW - HOUR },
    })
    expect(service.setEnabled(true).isEnabled).toBe(true)
  })
})

describe('updateDialogFor', () => {
  it('offers the release page for a newer release', () => {
    expect(updateDialogFor({ check: NEWER, current: CURRENT })).toEqual({
      type: 'info',
      message: 'Raven 0.6.0 is out.',
      detail:
        'Download it from its release page. While Raven is signed ad hoc it cannot update itself.',
      buttons: ['See Release', 'Later'],
      defaultId: 0,
      cancelId: 1,
      opensRelease: true,
    })
  })

  it('says the running version is the newest', () => {
    expect(updateDialogFor({ check: UP_TO_DATE, current: CURRENT })).toEqual({
      type: 'info',
      message: 'Raven 0.5.4 is the newest release.',
      detail: '',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      opensRelease: false,
    })
  })

  it('warns with the problem when the check failed', () => {
    expect(updateDialogFor({ check: UNREACHABLE, current: CURRENT })).toEqual({
      type: 'warning',
      message: UPDATE_COPY.failed,
      detail: UPDATE_PROBLEMS.unreachable,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      opensRelease: false,
    })
  })
})

describe('updateSourceFrom', () => {
  const HOOK = 'http://127.0.0.1:4000/releases'

  it('asks GitHub and checks at launch when packaged, whatever the hook says', () => {
    expect(
      updateSourceFrom({ isPackaged: true, env: { RAVEN_DESKTOP_RELEASES_URL: HOOK } }),
    ).toEqual({ url: RELEASES_URL, isLaunchCheckAllowed: true })
  })

  it('asks the hook and checks at launch when unpackaged with the hook set', () => {
    expect(
      updateSourceFrom({ isPackaged: false, env: { RAVEN_DESKTOP_RELEASES_URL: HOOK } }),
    ).toEqual({ url: HOOK, isLaunchCheckAllowed: true })
  })

  it('never checks at launch unpackaged without the hook, and the menu asks GitHub', () => {
    expect(updateSourceFrom({ isPackaged: false, env: {} })).toEqual({
      url: RELEASES_URL,
      isLaunchCheckAllowed: false,
    })
    expect(
      updateSourceFrom({ isPackaged: false, env: { RAVEN_DESKTOP_RELEASES_URL: '' } }),
    ).toEqual({ url: RELEASES_URL, isLaunchCheckAllowed: false })
  })
})

describe('createMenuCheck', () => {
  const menuSetup = ({
    check = async () => NEWER,
    isOpened = true,
    responses = [0],
  }: {
    check?: () => Promise<UpdateCheck>
    isOpened?: boolean
    responses?: number[]
  } = {}) => {
    const shown: UpdateDialogOptions[] = []
    const announced: string[] = []
    const calls = { checks: 0, opens: 0 }
    const answers = [...responses]
    const menuCheck = createMenuCheck({
      updates: {
        checkNow: () => {
          calls.checks += 1
          return check()
        },
        openRelease: async () => {
          calls.opens += 1
          return isOpened
        },
      },
      current: CURRENT,
      show: async (options) => {
        shown.push(options)
        return answers.shift() ?? 0
      },
      announce: (version) => {
        announced.push(version)
      },
    })
    return { menuCheck, shown, calls, announced }
  }

  it('tells the page about a newer release, so an open Settings shows it', async () => {
    const { menuCheck, announced } = menuSetup({ responses: [1] })
    await menuCheck()
    expect(announced).toEqual(['0.6.0'])
  })

  it('announces nothing when nothing newer was found or the check failed', async () => {
    const current = menuSetup({ check: async () => UP_TO_DATE })
    await current.menuCheck()
    const unlisted = menuSetup({ check: async () => UNLISTED })
    await unlisted.menuCheck()
    expect([...current.announced, ...unlisted.announced]).toEqual([])
    expect(unlisted.shown.at(0)?.detail ?? null).toBe(UPDATE_PROBLEMS.unlisted)
  })

  it('shows one dialog for a second click while the first check runs', async () => {
    const answer = Promise.withResolvers<UpdateCheck>()
    const { menuCheck, shown, calls } = menuSetup({ check: () => answer.promise })
    const first = menuCheck()
    const second = menuCheck()
    answer.resolve(UP_TO_DATE)
    await Promise.all([first, second])
    expect(calls.checks).toBe(1)
    expect(shown.map(({ message }) => message)).toEqual([UPDATE_COPY.current(CURRENT)])
  })

  it('checks again once the first check and its dialog are done', async () => {
    const { menuCheck, calls, shown } = menuSetup({ check: async () => UP_TO_DATE })
    await menuCheck()
    await menuCheck()
    expect(calls.checks).toBe(2)
    expect(shown).toHaveLength(2)
  })

  it('checks again after a check that failed', async () => {
    const { menuCheck, calls } = menuSetup({
      check: async () => {
        throw new Error('broken')
      },
    })
    await expect(menuCheck()).rejects.toThrow('broken')
    await expect(menuCheck()).rejects.toThrow('broken')
    expect(calls.checks).toBe(2)
  })

  it('opens the release page from See Release and shows nothing more', async () => {
    const { menuCheck, calls, shown } = menuSetup()
    await menuCheck()
    expect(calls.opens).toBe(1)
    expect(shown).toHaveLength(1)
  })

  it('opens nothing from Later', async () => {
    const { menuCheck, calls, shown } = menuSetup({ responses: [1] })
    await menuCheck()
    expect(calls.opens).toBe(0)
    expect(shown).toHaveLength(1)
  })

  it('says so when the release page could not be opened', async () => {
    const { menuCheck, shown } = menuSetup({ isOpened: false })
    await menuCheck()
    expect(shown.at(1)).toEqual({
      type: 'warning',
      message: 'Raven could not open the release page.',
      detail: '',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
    })
  })
})
