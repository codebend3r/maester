import { expect, it, mock } from 'bun:test'
import { createMenuHub } from '@/renderer/desktop/menuHub'

it('tells every subscriber the next action', () => {
  const hub = createMenuHub()
  const first = mock(() => undefined)
  const second = mock(() => undefined)
  hub.subscribe(first)
  hub.subscribe(second)
  hub.emit('next')
  expect(first).toHaveBeenCalledWith('next')
  expect(second).toHaveBeenCalledWith('next')
})

it('stops telling one that unsubscribed', () => {
  const hub = createMenuHub()
  const kept = mock(() => undefined)
  const dropped = mock(() => undefined)
  hub.subscribe(kept)
  hub.subscribe(dropped)()
  hub.emit('togglePlay')
  expect(kept).toHaveBeenCalledTimes(1)
  expect(dropped).not.toHaveBeenCalled()
})
