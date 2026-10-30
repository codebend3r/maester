import { describe, expect, it } from 'bun:test'
import { IPC_CHANNELS, MAX_QUEUE } from '@/shared/hostNames'

describe('constants', () => {
  it('names the two channels, the player channel and the music channel', () => {
    expect(IPC_CHANNELS).toEqual({
      request: 'raven:request',
      event: 'raven:event',
      player: 'raven:player',
      audio: 'raven:audio',
    })
    expect(MAX_QUEUE).toBe(100)
  })
})
