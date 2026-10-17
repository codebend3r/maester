import { expect, test } from 'bun:test'
import { createActivity } from '@/main/player/activity'

const setup = () => {
  const log: string[] = []
  const activity = createActivity({
    onPlaying: (isPlaying) => log.push(`playing ${isPlaying}`),
    onShowing: (isShowing) => log.push(`showing ${isShowing}`),
  })
  return { log, activity }
}

test('every report reaches the sleep guard, a change of showing reaches the window once', () => {
  const { log, activity } = setup()
  activity.report({ isPlaying: false, isShowing: true })
  activity.report({ isPlaying: true, isShowing: true })
  activity.report({ isPlaying: false, isShowing: true })
  activity.report({ isPlaying: false, isShowing: false })
  activity.report({ isPlaying: false, isShowing: false })
  expect(log).toEqual([
    'playing false',
    'showing true',
    'playing true',
    'playing false',
    'playing false',
    'showing false',
    'playing false',
  ])
})

test('starts as not showing, so a first report that shows nothing changes nothing', () => {
  const { log, activity } = setup()
  activity.report({ isPlaying: false, isShowing: false })
  expect(log).toEqual(['playing false'])
})

test('hide puts the window back for Home whatever the service last said', () => {
  const { log, activity } = setup()
  activity.report({ isPlaying: true, isShowing: true })
  log.length = 0
  activity.hide()
  expect(log).toEqual(['playing false', 'showing false'])
})

test('hide forces the window back even when nothing was showing', () => {
  const { log, activity } = setup()
  activity.hide()
  expect(log).toEqual(['playing false', 'showing false'])
})

test('after hide, the next video shows again', () => {
  const { log, activity } = setup()
  activity.report({ isPlaying: true, isShowing: true })
  activity.hide()
  log.length = 0
  activity.report({ isPlaying: false, isShowing: true })
  expect(log).toEqual(['playing false', 'showing true'])
})
