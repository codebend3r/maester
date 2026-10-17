import { expect, test } from 'bun:test'
import { createSleepGuard } from '@/main/player/sleepGuard'

test('starts once and stops the started id once', () => {
  const starts: number[] = []
  const stops: number[] = []
  const guard = createSleepGuard({
    start: () => {
      starts.push(41)
      return 41
    },
    stop: (id) => stops.push(id),
  })
  guard.set(true)
  guard.set(true)
  guard.set(false)
  guard.set(false)
  expect(starts).toEqual([41])
  expect(stops).toEqual([41])
})

test('stopping before starting does nothing and a later start works again', () => {
  const stops: number[] = []
  let next = 0
  const guard = createSleepGuard({
    start: () => {
      next += 1
      return next
    },
    stop: (id) => stops.push(id),
  })
  guard.set(false)
  guard.set(true)
  guard.set(false)
  guard.set(true)
  guard.set(false)
  expect(stops).toEqual([1, 2])
})
