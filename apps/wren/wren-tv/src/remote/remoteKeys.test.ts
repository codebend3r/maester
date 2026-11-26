import { describe, expect, it } from 'bun:test'

import { KEY_ACTIONS, MEDIA_SKIP_KEYS, REMOTE_KEYS } from '@raven/native/headless'

import { QUEUE_ACTIONS, queueActionOf } from '@/remote/remoteKeys'

describe('queueActionOf', () => {
  it('plays or pauses on the play and pause key', () => {
    expect(queueActionOf({ eventType: REMOTE_KEYS.playPause })).toBe(QUEUE_ACTIONS.playPause)
  })

  it('steps to the next and the last track on the skip keys', () => {
    expect(queueActionOf({ eventType: REMOTE_KEYS.fastForward })).toBe(QUEUE_ACTIONS.fastForward)
    expect(queueActionOf({ eventType: REMOTE_KEYS.rewind })).toBe(QUEUE_ACTIONS.rewind)
    expect(queueActionOf({ eventType: MEDIA_SKIP_KEYS.next })).toBe(QUEUE_ACTIONS.next)
    expect(queueActionOf({ eventType: MEDIA_SKIP_KEYS.previous })).toBe(QUEUE_ACTIONS.previous)
  })

  it('counts an Android TV key once, as it comes up', () => {
    expect(
      queueActionOf({ eventType: REMOTE_KEYS.playPause, eventKeyAction: KEY_ACTIONS.down }),
    ).toBeNull()
    expect(
      queueActionOf({ eventType: REMOTE_KEYS.playPause, eventKeyAction: KEY_ACTIONS.up }),
    ).toBe(QUEUE_ACTIONS.playPause)
  })

  it('leaves the d-pad and select to the focus engine', () => {
    expect(queueActionOf({ eventType: REMOTE_KEYS.select })).toBeNull()
    expect(queueActionOf({ eventType: REMOTE_KEYS.left })).toBeNull()
    expect(queueActionOf(null)).toBeNull()
  })
})
