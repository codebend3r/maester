import { describe, expect, it } from 'bun:test'

import { MEDIA_KEYS, QUEUE_ACTIONS, queueActionOf } from '@/remote/remoteKeys'

describe('queueActionOf', () => {
  it('plays or pauses on the play and pause key', () => {
    expect(queueActionOf({ eventType: MEDIA_KEYS.playPause })).toBe(QUEUE_ACTIONS.playPause)
  })

  it('steps to the next and the last track on the skip keys', () => {
    expect(queueActionOf({ eventType: MEDIA_KEYS.fastForward })).toBe(QUEUE_ACTIONS.fastForward)
    expect(queueActionOf({ eventType: MEDIA_KEYS.rewind })).toBe(QUEUE_ACTIONS.rewind)
    expect(queueActionOf({ eventType: MEDIA_KEYS.next })).toBe(QUEUE_ACTIONS.next)
    expect(queueActionOf({ eventType: MEDIA_KEYS.previous })).toBe(QUEUE_ACTIONS.previous)
  })

  it('counts an Android TV key once, as it comes up', () => {
    expect(queueActionOf({ eventType: MEDIA_KEYS.playPause, eventKeyAction: 0 })).toBeNull()
    expect(queueActionOf({ eventType: MEDIA_KEYS.playPause, eventKeyAction: 1 })).toBe(
      QUEUE_ACTIONS.playPause,
    )
  })

  it('leaves the d-pad and select to the focus engine', () => {
    expect(queueActionOf({ eventType: 'select' })).toBeNull()
    expect(queueActionOf({ eventType: 'left' })).toBeNull()
    expect(queueActionOf(null)).toBeNull()
  })
})
