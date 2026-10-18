import { type ConfigStore, setUpdates } from '@/main/desktopConfig'
import { errorText } from '@/main/log/errorText'
import {
  isCheckDue,
  RELEASES_URL,
  UPDATE_FINDING_KINDS,
  UPDATE_PROBLEMS,
  type UpdateCheck,
  type UpdateFinding,
} from '@/main/updates'
import type { UpdateStatus } from '@/shared/protocol'

const RELEASES_HOOK = 'RAVEN_DESKTOP_RELEASES_URL'

export const UPDATE_COPY = {
  newer: (version: string) => `raven player ${version} is out.`,
  newerDetail:
    'Download it from its release page. While raven player is signed ad hoc it cannot update itself.',
  current: (version: string) => `raven player ${version} is the newest release.`,
  failed: 'raven player could not check for updates.',
  noRelease: 'raven player has not found a newer release.',
  unopened: 'raven player could not open the release page.',
} as const

const DIALOG_TYPES = { info: 'info', warning: 'warning' } as const

/** What `dialog.showMessageBox` is given. */
export type UpdateDialogOptions = {
  type: (typeof DIALOG_TYPES)[keyof typeof DIALOG_TYPES]
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

export type UpdateDialog = UpdateDialogOptions & { opensRelease: boolean }

/** What Check for Updates… shows for a check's outcome. */
export const updateDialogFor = ({
  check,
  current,
}: {
  check: UpdateCheck
  current: string
}): UpdateDialog => {
  if (!check.ok) {
    return {
      type: DIALOG_TYPES.warning,
      message: UPDATE_COPY.failed,
      detail: check.problem,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      opensRelease: false,
    }
  }
  const { finding } = check
  switch (finding.kind) {
    case UPDATE_FINDING_KINDS.newer:
      return {
        type: DIALOG_TYPES.info,
        message: UPDATE_COPY.newer(finding.version),
        detail: UPDATE_COPY.newerDetail,
        buttons: ['See Release', 'Later'],
        defaultId: 0,
        cancelId: 1,
        opensRelease: true,
      }
    case UPDATE_FINDING_KINDS.current:
      return {
        type: DIALOG_TYPES.info,
        message: UPDATE_COPY.current(current),
        detail: '',
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        opensRelease: false,
      }
    default: {
      const unreachable: never = finding
      return unreachable
    }
  }
}

const unopenedDialog = (): UpdateDialogOptions => ({
  type: DIALOG_TYPES.warning,
  message: UPDATE_COPY.unopened,
  detail: '',
  buttons: ['OK'],
  defaultId: 0,
  cancelId: 0,
})

/**
 * Check for Updates… from the menu: checks, tells the page about a newer release, shows the
 * outcome, and opens the release page from See Release. A click while one is still running,
 * its dialog included, does nothing.
 */
export const createMenuCheck = ({
  updates,
  current,
  show,
  announce,
}: {
  updates: Pick<UpdateService, 'checkNow' | 'openRelease'>
  current: string
  show: (options: UpdateDialogOptions) => Promise<number>
  announce: (version: string) => void
}): (() => Promise<void>) => {
  let isRunning = false

  const run = async (): Promise<void> => {
    const check = await updates.checkNow()
    // So an open Settings refreshes and the notice appears, as after a launch check.
    if (check.ok && check.finding.kind === UPDATE_FINDING_KINDS.newer)
      announce(check.finding.version)
    const { opensRelease, ...options } = updateDialogFor({ check, current })
    const response = await show(options)
    if (!opensRelease || response !== 0) return
    if (await updates.openRelease()) return
    await show(unopenedDialog())
  }

  return async () => {
    if (isRunning) return
    isRunning = true
    try {
      await run()
    } finally {
      isRunning = false
    }
  }
}

/**
 * Where the check asks, and whether it may run at launch (Ruling 10): unpackaged, only the
 * test hook allows it, so `dev` and e2e never call GitHub on their own. Packaged, the hook
 * is never read.
 */
export const updateSourceFrom = ({
  isPackaged,
  env,
}: {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
}): { url: string; isLaunchCheckAllowed: boolean } => {
  if (isPackaged) return { url: RELEASES_URL, isLaunchCheckAllowed: true }
  const hook = env[RELEASES_HOOK] ?? ''
  if (hook === '') return { url: RELEASES_URL, isLaunchCheckAllowed: false }
  return { url: hook, isLaunchCheckAllowed: true }
}

export type UpdateService = {
  status: () => UpdateStatus
  setEnabled: (isEnabled: boolean) => UpdateStatus
  checkNow: () => Promise<UpdateCheck>
  /** At launch: checks only when due and enabled, and tells the page about a newer release. */
  atLaunch: () => Promise<void>
  openRelease: () => Promise<boolean>
}

type NewerFinding = Extract<UpdateFinding, { kind: typeof UPDATE_FINDING_KINDS.newer }>

export const createUpdateService = ({
  config,
  check,
  current,
  now,
  openExternal,
  announce,
  warn,
}: {
  config: ConfigStore
  check: () => Promise<UpdateCheck>
  current: string
  now: () => number
  openExternal: (url: string) => Promise<void>
  announce: (version: string) => void
  warn: (message: string) => void
}): UpdateService => {
  // Kept for the session only: a restart asks again when the check is due.
  let finding: NewerFinding | null = null
  let problem: string | null = null
  let pending: Promise<UpdateCheck> | null = null

  const status = (): UpdateStatus => {
    const { isEnabled, checkedAt } = config.read().updates
    return { isEnabled, current, checkedAt, latest: finding?.version ?? null, problem }
  }

  const setEnabled = (isEnabled: boolean): UpdateStatus => {
    config.update((stored) =>
      setUpdates({ config: stored, updates: { ...stored.updates, isEnabled } }),
    )
    return status()
  }

  const run = async (): Promise<UpdateCheck> => {
    const result = await Promise.resolve()
      .then(check)
      .catch((): UpdateCheck => ({ ok: false, problem: UPDATE_PROBLEMS.unreachable }))
    // Whatever the outcome, so a GitHub that keeps failing is not asked at every launch.
    const checkedAt = now()
    config.update((stored) =>
      setUpdates({ config: stored, updates: { ...stored.updates, checkedAt } }),
    )
    if (!result.ok) {
      problem = result.problem
      warn(`raven player could not check for updates: ${result.problem}`)
      return result
    }
    problem = null
    finding = result.finding.kind === UPDATE_FINDING_KINDS.newer ? result.finding : null
    return result
  }

  const checkNow = (): Promise<UpdateCheck> => {
    if (pending !== null) return pending
    const started = run().finally(() => {
      pending = null
    })
    pending = started
    return started
  }

  const atLaunch = async (): Promise<void> => {
    const { isEnabled, checkedAt } = config.read().updates
    if (!isCheckDue({ isEnabled, checkedAt, now: now() })) return
    const result = await checkNow()
    if (result.ok && result.finding.kind === UPDATE_FINDING_KINDS.newer)
      announce(result.finding.version)
  }

  const openRelease = async (): Promise<boolean> => {
    if (finding === null) return false
    try {
      await openExternal(finding.pageUrl)
      return true
    } catch (error) {
      warn(`raven player could not open the release page: ${errorText(error)}`)
      return false
    }
  }

  return { status, setEnabled, checkNow, atLaunch, openRelease }
}
