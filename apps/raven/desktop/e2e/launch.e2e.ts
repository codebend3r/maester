import { expect, test } from '@playwright/test'
import { freshUserData, launchMarkWithin, removeDir, withApp } from '@/e2e/harness'

const LAUNCHES = 5
// Twice the 800 ms cold launch budget (spec section 8), from main's first line to ready-to-show.
const MEDIAN_LIMIT_MS = 1600

// The mark follows the window by a frame or so; this only turns a missed mark into an error.
const MARK_WAIT_MS = 10_000
// Five launches and quits on a slower CI runner, with room to spare.
const TEST_TIMEOUT_MS = 120_000

const launchOnce = async (): Promise<number> => {
  const userData = await freshUserData()
  return withApp({
    userData,
    run: (launched) => launchMarkWithin({ launched, ms: MARK_WAIT_MS }),
  }).finally(() => removeDir(userData))
}

test('opens its window within twice the cold launch budget', async () => {
  test.setTimeout(TEST_TIMEOUT_MS)
  // One after another, never overlapping, so each launch has the machine to itself.
  const marks = await Array.from({ length: LAUNCHES }).reduce<Promise<number[]>>(
    async (previous) => [...(await previous), await launchOnce()],
    Promise.resolve([]),
  )
  const median = marks.toSorted((a, b) => a - b).at(Math.floor(LAUNCHES / 2)) ?? Infinity
  process.stdout.write(`raven-launch-ms marks ${marks.join(', ')}; median ${median}\n`)

  expect(marks).toHaveLength(LAUNCHES)
  expect(median).toBeLessThan(MEDIAN_LIMIT_MS)
})
