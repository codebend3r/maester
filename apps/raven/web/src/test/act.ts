import { configure, getConfig } from '@testing-library/react'
import { unstable_IdlePriority, unstable_scheduleCallback } from 'scheduler'

/** Resolves once React's scheduler has run every render and effect queued ahead of it. */
const reactIdle = (): Promise<void> =>
  new Promise((resolve) => {
    unstable_scheduleCallback(unstable_IdlePriority, () => resolve())
  })

/**
 * Has every waitFor, findBy and user-event call wait for React to finish
 * rendering before it hands back. Testing Library turns act back on one
 * setTimeout(0) after the wait settles, but React renders a big tree, the
 * player above all, in 5ms slices on its scheduler. The rest of that render
 * then commits with act on, and each store write in its effects warns.
 */
export const settleAsyncHelpers = (): void => {
  const { asyncWrapper } = getConfig()
  configure({
    asyncWrapper: (callback) =>
      asyncWrapper(async () => {
        const result = await callback()
        await reactIdle()
        return result
      }),
  })
}

const ACT_WARNING = 'not wrapped in act('

type Heard = { warnings: string[] }

const heard: Heard = { warnings: [] }

/** Notes each act warning React logs, so the test that caused it fails instead of passing noisily. */
export const listenForActWarnings = (): void => {
  const consoleError = console.error
  console.error = (...args: unknown[]) => {
    const [format, component] = args
    if (typeof format === 'string' && format.includes(ACT_WARNING)) {
      heard.warnings = [...heard.warnings, format.replace('%s', String(component))]
    }
    consoleError(...args)
  }
}

/** Fails the test that just ran if React warned of an update outside act. */
export const failOnActWarnings = (): void => {
  const { warnings } = heard
  heard.warnings = []
  if (warnings.length === 0) return
  throw new Error(
    `React updated outside act() ${warnings.length} times; wrap the update in act() or await what it waits on:\n${[...new Set(warnings)].join('\n')}`,
  )
}
