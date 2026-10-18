import { PLAYBACK_MODES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import {
  IDLE_MS,
  type StreamClient,
  type StreamConnection,
  StreamSessions,
} from '@/streams/streamSessions'

const ANNA: StreamClient = { address: '10.0.0.5', userAgent: 'Anna Browser' }
const BEN: StreamClient = { address: '10.0.0.6', userAgent: 'Ben Browser' }

/** A response that has sent `sent` bytes, and counts how often it was cut off. */
const connection = () => {
  const state = { sent: 0, closed: 0 }
  const open: StreamConnection = {
    written: () => state.sent,
    close: () => {
      state.closed += 1
    },
  }
  return { state, open }
}

describe('StreamSessions', () => {
  it('makes one stream of a client’s requests for a video, and one each for others', () => {
    const sessions = new StreamSessions()
    const first = connection()
    const second = connection()
    const other = connection()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: first.open,
      now: 0,
    })
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: second.open,
      now: 1000,
    })
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: BEN,
      connection: other.open,
      now: 1000,
    })
    sessions.open({
      mediaId: 2,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: other.open,
      now: 1000,
    })

    const listed = sessions.list({ now: 2000 })
    expect(listed.map(({ mediaId, client }) => [mediaId, client.address])).toEqual([
      [1, '10.0.0.5'],
      [1, '10.0.0.6'],
      [2, '10.0.0.5'],
    ])
    expect(listed[0]).toMatchObject({ startedAt: 0, lastSeenAt: 1000, position: null })
  })

  it('takes the way a video is sent from the latest request', () => {
    const sessions = new StreamSessions()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: connection().open,
      now: 0,
    })
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.transcode,
      client: ANNA,
      connection: connection().open,
      now: 1,
    })
    expect(sessions.list({ now: 2 }).map(({ mode }) => mode)).toEqual([PLAYBACK_MODES.transcode])
  })

  it('keeps the position the player reports, and ignores a report for no stream', () => {
    const sessions = new StreamSessions()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: connection().open,
      now: 0,
    })
    sessions.report({ mediaId: 1, client: ANNA, position: 42, now: 5000 })
    sessions.report({ mediaId: 1, client: BEN, position: 99, now: 5000 })
    sessions.report({ mediaId: 7, client: ANNA, position: 99, now: 5000 })

    expect(sessions.list({ now: 6000 })).toEqual([
      expect.objectContaining({ client: ANNA, position: 42, lastSeenAt: 5000 }),
    ])
  })

  it('forgets a stream that went quiet, and keeps one whose reports go on', () => {
    const sessions = new StreamSessions()
    const quiet = connection()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: quiet.open,
      now: 0,
    })
    sessions.open({
      mediaId: 2,
      mode: PLAYBACK_MODES.direct,
      client: BEN,
      connection: connection().open,
      now: 0,
    })
    sessions.report({ mediaId: 2, client: BEN, position: 10, now: IDLE_MS - 1 })

    expect(sessions.list({ now: IDLE_MS }).map(({ mediaId }) => mediaId)).toEqual([2])
  })

  it('keeps a stream whose response is still sending bytes, even without reports', () => {
    const sessions = new StreamSessions()
    const sending = connection()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.transcode,
      client: ANNA,
      connection: sending.open,
      now: 0,
    })

    sending.state.sent = 1024
    expect(sessions.list({ now: IDLE_MS - 1 })).toHaveLength(1)
    sending.state.sent = 2048
    expect(sessions.list({ now: IDLE_MS * 1.5 })).toHaveLength(1)
    // Paused: its connection stays open but nothing moves.
    expect(sessions.list({ now: IDLE_MS * 3 })).toHaveLength(0)
  })

  it('cuts off every open response of a stopped stream and forgets it', () => {
    const sessions = new StreamSessions()
    const first = connection()
    const second = connection()
    const released = connection()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: first.open,
      now: 0,
    })
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: second.open,
      now: 0,
    })
    const release = sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: released.open,
      now: 0,
    })
    release()
    const [stream] = sessions.list({ now: 1 })

    expect(sessions.stop(stream?.id ?? '')).toBe(true)
    expect([first.state.closed, second.state.closed, released.state.closed]).toEqual([1, 1, 0])
    expect(sessions.list({ now: 1 })).toEqual([])
    // A progress report from the player still playing what it buffered does not bring it back.
    sessions.report({ mediaId: 1, client: ANNA, position: 3, now: 2 })
    expect(sessions.list({ now: 2 })).toEqual([])
    expect(sessions.stop(stream?.id ?? '')).toBe(false)
  })

  it('starts a new stream when a stopped client asks again', () => {
    const sessions = new StreamSessions()
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: connection().open,
      now: 0,
    })
    const [before] = sessions.list({ now: 1 })
    sessions.stop(before?.id ?? '')
    sessions.open({
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      client: ANNA,
      connection: connection().open,
      now: 10,
    })

    const [after] = sessions.list({ now: 11 })
    expect(after?.id).not.toBe(before?.id)
    expect(after?.startedAt).toBe(10)
  })

  it('has nothing to stop for an id that is not live', () => {
    expect(new StreamSessions().stop('nothing')).toBe(false)
  })
})
