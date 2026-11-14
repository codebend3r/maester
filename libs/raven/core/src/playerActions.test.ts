import { describe, expect, it } from 'bun:test'
import { PLAYER_ANSWERS, type PlayerActionState, resolvePlayerAction } from '@/playerActions'
import { PLAYER_ACTIONS, SEEK_EDGES } from '@/shortcuts'

const STATE: PlayerActionState = {
  position: 100,
  duration: 600,
  volume: 0.5,
  isMuted: false,
  lastSkip: null,
  now: 0,
}

describe('resolvePlayerAction', () => {
  it('skips 10 seconds, and further for a quick second press the same way', () => {
    const first = resolvePlayerAction({
      action: { type: PLAYER_ACTIONS.skip, direction: 1 },
      state: STATE,
    })
    expect(first.answer).toEqual({ type: PLAYER_ANSWERS.seek, to: 110 })
    const second = resolvePlayerAction({
      action: { type: PLAYER_ACTIONS.skip, direction: 1 },
      state: { ...STATE, lastSkip: first.lastSkip, now: 200 },
    })
    expect(second.answer).toEqual({ type: PLAYER_ANSWERS.seek, to: 120 })
  })

  it('seeks to a fraction once the length is known, and to either edge', () => {
    const fraction = { type: PLAYER_ACTIONS.seekToFraction, fraction: 0.5 } as const
    expect(resolvePlayerAction({ action: fraction, state: STATE }).answer).toEqual({
      type: PLAYER_ANSWERS.seek,
      to: 300,
    })
    expect(
      resolvePlayerAction({ action: fraction, state: { ...STATE, duration: null } }).answer,
    ).toBeNull()
    expect(
      resolvePlayerAction({
        action: { type: PLAYER_ACTIONS.seekToEdge, edge: SEEK_EDGES.end },
        state: STATE,
      }).answer,
    ).toEqual({ type: PLAYER_ANSWERS.seek, to: 600 })
  })

  it('steps the volume within 0 and 1, unmuting from silence, and mutes', () => {
    expect(
      resolvePlayerAction({
        action: { type: PLAYER_ACTIONS.volumeBy, delta: 0.8 },
        state: STATE,
      }).answer,
    ).toEqual({ type: PLAYER_ANSWERS.volume, volume: 1, isMuted: false })
    expect(
      resolvePlayerAction({
        action: { type: PLAYER_ACTIONS.volumeBy, delta: 0.1 },
        state: { ...STATE, isMuted: true },
      }).answer,
    ).toEqual({ type: PLAYER_ANSWERS.volume, volume: 0.1, isMuted: false })
    expect(
      resolvePlayerAction({ action: { type: PLAYER_ACTIONS.toggleMute }, state: STATE }).answer,
    ).toEqual({ type: PLAYER_ANSWERS.volume, volume: 0.5, isMuted: true })
  })

  it('hands what only the host can do back to it, the skips counted as they were', () => {
    const action = { type: PLAYER_ACTIONS.toggleFullscreen } as const
    expect(resolvePlayerAction({ action, state: STATE })).toEqual({
      answer: { type: PLAYER_ANSWERS.host, action },
      lastSkip: null,
    })
  })
})
