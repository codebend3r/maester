import { describe, expect, it } from 'bun:test'

import { KEY_ACTIONS, LONG_PRESS_NAMES, REMOTE_KEYS } from '@raven/native/headless'

import { REMOTE_HOLDERS, heldSeekOf, remoteAnswerOf, remoteHolderOf } from '@/layouts/remoteKeys'

const PLAYING = { isShown: true, isScrubbing: false, isPaused: false }

describe('remoteAnswerOf', () => {
  it('seeks ten seconds either way from the scrubber', () => {
    const scrubbing = { ...PLAYING, isScrubbing: true }
    expect(remoteAnswerOf({ key: REMOTE_KEYS.left, ...scrubbing }).skip).toBe(-1)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.right, ...scrubbing }).skip).toBe(1)
  })

  it('seeks while the controls are hidden, as the press brings them back', () => {
    const hidden = { ...PLAYING, isShown: false }
    expect(remoteAnswerOf({ key: REMOTE_KEYS.right, ...hidden }).skip).toBe(1)
  })

  it('leaves left and right to move the focus along the buttons', () => {
    expect(remoteAnswerOf({ key: REMOTE_KEYS.left, ...PLAYING })).toEqual({
      skip: null,
      shouldTogglePlay: false,
    })
  })

  it("seeks on the remote's rewind and fast forward wherever the focus is", () => {
    expect(remoteAnswerOf({ key: REMOTE_KEYS.rewind, ...PLAYING }).skip).toBe(-1)
    expect(remoteAnswerOf({ key: REMOTE_KEYS.fastForward, ...PLAYING }).skip).toBe(1)
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
      others.map(() => ({ skip: null, shouldTogglePlay: false })),
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

describe('remoteHolderOf', () => {
  it('gives the remote to the controls while they show, and to the catcher once they go', () => {
    expect(
      remoteHolderOf({ isVisible: true, isUpNextOffered: false, isIntroPrompting: false }),
    ).toBe(REMOTE_HOLDERS.controls)
    expect(
      remoteHolderOf({ isVisible: false, isUpNextOffered: false, isIntroPrompting: false }),
    ).toBe(REMOTE_HOLDERS.catcher)
  })

  it('leaves it with the up next card while that is offered, controls or none', () => {
    expect(
      remoteHolderOf({ isVisible: true, isUpNextOffered: true, isIntroPrompting: false }),
    ).toBe(REMOTE_HOLDERS.upNext)
    expect(
      remoteHolderOf({ isVisible: false, isUpNextOffered: true, isIntroPrompting: false }),
    ).toBe(REMOTE_HOLDERS.upNext)
  })

  it("gives it to Skip intro's card while it prompts, controls or none", () => {
    expect(
      remoteHolderOf({ isVisible: true, isUpNextOffered: false, isIntroPrompting: true }),
    ).toBe(REMOTE_HOLDERS.intro)
    expect(
      remoteHolderOf({ isVisible: false, isUpNextOffered: false, isIntroPrompting: true }),
    ).toBe(REMOTE_HOLDERS.intro)
  })

  it('puts the up next card before Skip intro', () => {
    expect(
      remoteHolderOf({ isVisible: false, isUpNextOffered: true, isIntroPrompting: true }),
    ).toBe(REMOTE_HOLDERS.upNext)
  })
})
