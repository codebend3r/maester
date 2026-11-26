import { describe, expect, it } from 'bun:test'

import {
  KEY_ACTIONS,
  LONG_PRESSES,
  MEDIA_SKIP_KEYS,
  REMOTE_KEYS,
  keyUpNameOf,
  pressedKeyOf,
} from '@/remote/remoteKeys'

/** A key the fork names that neither app answers. */
const UNANSWERED = { menu: 'menu' } as const

describe('keyUpNameOf', () => {
  it('takes a key as it comes up, the one action Android TV sends for a press', () => {
    expect(keyUpNameOf({ eventType: REMOTE_KEYS.playPause, eventKeyAction: KEY_ACTIONS.up })).toBe(
      REMOTE_KEYS.playPause,
    )
  })

  it('lets the same key going down go, so a press counts once where both are sent', () => {
    expect(
      keyUpNameOf({ eventType: REMOTE_KEYS.playPause, eventKeyAction: KEY_ACTIONS.down }),
    ).toBeNull()
  })

  it('takes an event that names no action, as tvOS sends them', () => {
    expect(keyUpNameOf({ eventType: REMOTE_KEYS.select })).toBe(REMOTE_KEYS.select)
    expect(keyUpNameOf({ eventType: REMOTE_KEYS.select, eventKeyAction: null })).toBe(
      REMOTE_KEYS.select,
    )
  })

  it('names any key, a held one by its long name', () => {
    expect(keyUpNameOf({ eventType: UNANSWERED.menu })).toBe(UNANSWERED.menu)
    expect(keyUpNameOf({ eventType: LONG_PRESSES.longRight, eventKeyAction: KEY_ACTIONS.up })).toBe(
      LONG_PRESSES.longRight,
    )
  })

  it('names nothing for an event that is not a key', () => {
    expect(keyUpNameOf(null)).toBeNull()
    expect(keyUpNameOf({ eventKeyAction: KEY_ACTIONS.up })).toBeNull()
  })
})

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

  it('leaves a key neither app answers', () => {
    expect(pressedKeyOf({ eventType: UNANSWERED.menu, eventKeyAction: KEY_ACTIONS.up })).toBeNull()
  })
  it("leaves the skip keys, which only Wren's queue answers", () => {
    expect(
      Object.values(MEDIA_SKIP_KEYS).map((eventType) =>
        pressedKeyOf({ eventType, eventKeyAction: KEY_ACTIONS.up }),
      ),
    ).toEqual([null, null])
  })
})
