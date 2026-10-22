import { describe, expect, it } from 'bun:test'
import { IPC_CHANNELS, MAX_QUEUE } from '@/shared/hostNames'

describe('constants', () => {
  it('names the two channels and the player channel', () => {
    expect(IPC_CHANNELS).toEqual({
      request: 'raven:request',
      event: 'raven:event',
      player: 'raven:player',
    })
    expect(MAX_QUEUE).toBe(100)
  })
})
