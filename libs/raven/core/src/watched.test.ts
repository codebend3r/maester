import { describe, expect, it } from 'bun:test'
import { isWatchedState, watchedStateOf } from '@/watched'

describe('watchedStateOf', () => {
  it('is unwatched when none of the total is watched', () => {
    expect(watchedStateOf({ watched: 0, total: 9 })).toBe('unwatched')
  })

  it('is partly when some is', () => {
    expect(watchedStateOf({ watched: 3, total: 9 })).toBe('partly')
  })

  it('is watched when all of it is', () => {
    expect(watchedStateOf({ watched: 9, total: 9 })).toBe('watched')
  })

  it('is unwatched when there is nothing to watch', () => {
    expect(watchedStateOf({ watched: 0, total: 0 })).toBe('unwatched')
  })
})

describe('isWatchedState', () => {
  it('takes the three states only', () => {
    expect(isWatchedState('partly')).toBe(true)
    expect(isWatchedState('seen')).toBe(false)
  })
})
