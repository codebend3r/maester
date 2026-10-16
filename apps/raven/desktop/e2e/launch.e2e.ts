import { expect, test } from '@playwright/test'
import { freshUserData, removeDir, withApp } from '@/e2e/harness'

const LAUNCHES = 5
// Twice the 800 ms cold launch budget (spec section 8), from main's first line to ready-to-show.
const MEDIAN_LIMIT_MS = 1600

const launchOnce = async (): Promise<number> => {
  const userData = await freshUserData()
  const ms = await withApp({ userData, run: ({ launchMs }) => launchMs }).finally(() =>
    removeDir(userData),
  )
  if (ms === null) throw new Error('raven player quit before printing its launch mark.')
  return ms
}

test('opens its window within twice the cold launch budget', async () => {
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
