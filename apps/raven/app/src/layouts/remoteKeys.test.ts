import { describe, expect, it } from 'bun:test'

import { SKIP_SECONDS } from '@/layouts/playerKit'
import {
  KEY_ACTIONS,
  LONG_PRESSES,
  LONG_PRESS_NAMES,
  REMOTE_KEYS,
  heldSeekOf,
  pressedKeyOf,
  remoteAnswerOf,
} from '@/layouts/remoteKeys'

/** A key the fork names that the player leaves alone. */
const UNANSWERED = { menu: 'menu' } as const

const PLAYING = { isShown: true, isScrubbing: false, isPaused: false }

describe('pressedKeyOf', () => {
  it('takes a key as it comes up, the one action Android TV sends for a press', () => {
    expect(pressedKeyOf({ eventType: REMOTE_KEYS.right, eventKeyAction: KEY_ACTIONS.up })).toBe(
      REMOTE_KEYS.right,
    )
  })

  it('lets the same key going down go, so a press counts once where both are sent', () => {
    expect(
      pressedKeyOf({ eventType: REMOTE_KEYS.right, eventKeyAction: KEY_ACTIONS.down }),
    ).toBeNull()
  })

  it('takes a key held down as the key, once it is let go', () => {
    const held = { eventType: LONG_PRESSES.longRight }
    expect(pressedKeyOf({ ...held, eventKeyAction: KEY_ACTIONS.down })).toBeNull()
    expect(pressedKeyOf({ ...held, eventKeyAction: KEY_ACTIONS.up })).toBe(REMOTE_KEYS.right)
  })

  it('takes a press that names no action', () => {
    expect(pressedKeyOf({ eventType: REMOTE_KEYS.select })).toBe(REMOTE_KEYS.select)
  })

  it('leaves a key the player does not answer', () => {
    expect(pressedKeyOf({ eventType: UNANSWERED.menu, eventKeyAction: KEY_ACTIONS.up })).toBeNull()
  })
})

describe('remoteAnswerOf', () => {
  it('seeks ten seconds either way from the scrubber', () => {
    const scrubbing = { ...PLAYING, isScrubbing: true }
    expect(remoteAnswerOf({ key: REMOTE_KEYS.left, ...scrubbing }).seekBy).toBe(-SKIP_SECONDS)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.right, ...scrubbing }).seekBy).toBe(SKIP_SECONDS)
  })

  it('seeks while the controls are hidden, as the press brings them back', () => {
    const hidden = { ...PLAYING, isShown: false }
    expect(remoteAnswerOf({ key: REMOTE_KEYS.right, ...hidden }).seekBy).toBe(SKIP_SECONDS)
  })

  it('leaves left and right to move the focus along the buttons', () => {
    expect(remoteAnswerOf({ key: REMOTE_KEYS.left, ...PLAYING })).toEqual({
      seekBy: 0,
      shouldTogglePlay: false,
    })
  })

  it("seeks on the remote's rewind and fast forward wherever the focus is", () => {
    expect(remoteAnswerOf({ key: REMOTE_KEYS.rewind, ...PLAYING }).seekBy).toBe(-SKIP_SECONDS)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.fastForward, ...PLAYING }).seekBy).toBe(SKIP_SECONDS)
  })

  it('plays and pauses on the play key, and on play or pause only when it changes something', () => {
    const paused = { ...PLAYING, isPaused: true }
    expect(remoteAnswerOf({ key: REMOTE_KEYS.playPause, ...PLAYING }).shouldTogglePlay).toBe(true)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.pause, ...PLAYING }).shouldTogglePlay).toBe(true)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.pause, ...paused }).shouldTogglePlay).toBe(false)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.play, ...paused }).shouldTogglePlay).toBe(true)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.play, ...PLAYING }).shouldTogglePlay).toBe(false)
  })

  it('does nothing more than bring the controls back for the other keys', () => {
    const others = [REMOTE_KEYS.up, REMOTE_KEYS.down, REMOTE_KEYS.select]
    expect(others.map((key) => remoteAnswerOf({ key, ...PLAYING, isShown: false }))).toEqual(
      others.map(() => ({ seekBy: 0, shouldTogglePlay: false })),
    )
  })
})

describe('heldSeekOf', () => {
  it('reads a held left or right, going down and coming up, and nothing else', () => {
    expect(
      heldSeekOf({ eventType: LONG_PRESS_NAMES.longRight, eventKeyAction: KEY_ACTIONS.down }),
    ).toEqual({
      direction: 1,
      isDown: true,
    })
    expect(
      heldSeekOf({ eventType: LONG_PRESS_NAMES.longLeft, eventKeyAction: KEY_ACTIONS.up }),
    ).toEqual({
      direction: -1,
      isDown: false,
    })
    expect(heldSeekOf({ eventType: REMOTE_KEYS.right, eventKeyAction: KEY_ACTIONS.up })).toBeNull()
    expect(
      heldSeekOf({ eventType: LONG_PRESS_NAMES.longSelect, eventKeyAction: KEY_ACTIONS.down }),
    ).toBeNull()
    expect(heldSeekOf({ eventType: 'toString', eventKeyAction: KEY_ACTIONS.down })).toBeNull()
  })
})
