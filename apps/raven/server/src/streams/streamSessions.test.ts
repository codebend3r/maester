import { PLAYBACK_MODES, STREAM_PURPOSES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import {
  IDLE_MS,
  type StreamClient,
  type StreamConnection,
  StreamSessions,
} from '@/streams/streamSessions'

const ANNA: StreamClient = { address: '10.0.0.5', userAgent: 'Anna Browser', viewer: null }
const BEN: StreamClient = { address: '10.0.0.6', userAgent: 'Ben Browser', viewer: null }

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
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: first.open,
      from: 0,
      now: 0,
    })
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: second.open,
      from: 0,
      now: 1000,
    })
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: BEN,
      connection: other.open,
      from: 0,
      now: 1000,
    })
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 2,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: other.open,
      from: 0,
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
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.transcode,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 1,
    })
    expect(sessions.list({ now: 2 }).map(({ mode }) => mode)).toEqual([PLAYBACK_MODES.transcode])
  })

  it('keeps the position the player reports, and ignores a report for no stream', () => {
    const sessions = new StreamSessions()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    sessions.report({ mediaId: 1, client: ANNA, position: 42, audio: null, now: 5000 })
    sessions.report({ mediaId: 1, client: BEN, position: 99, audio: null, now: 5000 })
    sessions.report({ mediaId: 7, client: ANNA, position: 99, audio: null, now: 5000 })

    expect(sessions.list({ now: 6000 })).toEqual([
      expect.objectContaining({ client: ANNA, position: 42, lastSeenAt: 5000 }),
    ])
  })

  it('forgets a stream that went quiet, and keeps one whose reports go on', () => {
    const sessions = new StreamSessions()
    const quiet = connection()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: quiet.open,
      from: 0,
      now: 0,
    })
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 2,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: BEN,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    sessions.report({ mediaId: 2, client: BEN, position: 10, audio: null, now: IDLE_MS - 1 })

    expect(sessions.list({ now: IDLE_MS }).map(({ mediaId }) => mediaId)).toEqual([2])
  })

  it('keeps a stream whose response is still sending bytes, even without reports', () => {
    const sessions = new StreamSessions()
    const sending = connection()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.transcode,
      quality: null,
      audio: null,
      client: ANNA,
      connection: sending.open,
      from: 0,
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
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: first.open,
      from: 0,
      now: 0,
    })
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: second.open,
      from: 0,
      now: 0,
    })
    const release = sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: released.open,
      from: 0,
      now: 0,
    })
    release()
    const [stream] = sessions.list({ now: 1 })

    expect(sessions.stop(stream?.id ?? '')).toBe(true)
    expect([first.state.closed, second.state.closed, released.state.closed]).toEqual([1, 1, 0])
    expect(sessions.list({ now: 1 })).toEqual([])
    // A progress report from the player still playing what it buffered does not bring it back.
    sessions.report({ mediaId: 1, client: ANNA, position: 3, audio: null, now: 2 })
    expect(sessions.list({ now: 2 })).toEqual([])
    expect(sessions.stop(stream?.id ?? '')).toBe(false)
  })

  it('starts a new stream when a stopped client asks again', () => {
    const sessions = new StreamSessions()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    const [before] = sessions.list({ now: 1 })
    sessions.stop(before?.id ?? '')
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 10,
    })

    const [after] = sessions.list({ now: 11 })
    expect(after?.id).not.toBe(before?.id)
    expect(after?.startedAt).toBe(10)
  })

  it('makes one stream per account on a shared browser', () => {
    const sessions = new StreamSessions()
    const cara: StreamClient = { ...ANNA, viewer: { id: 'cara-id', email: 'cara@example.com' } }
    const dev: StreamClient = { ...ANNA, viewer: { id: 'dev-id', email: 'dev@example.com' } }
    ;[cara, dev].forEach((client) =>
      sessions.open({
        purpose: STREAM_PURPOSES.play,
        mediaId: 1,
        mode: PLAYBACK_MODES.direct,
        quality: null,
        audio: null,
        client,
        connection: connection().open,
        from: 0,
        now: 0,
      }),
    )
    sessions.report({ mediaId: 1, client: dev, position: 30, audio: null, now: 5 })

    expect(
      sessions.list({ now: 10 }).map(({ client, position }) => [client.viewer?.email, position]),
    ).toEqual([
      ['cara@example.com', null],
      ['dev@example.com', 30],
    ])
  })

  it('keeps the audio a converted stream asked for until the player reports another', () => {
    const sessions = new StreamSessions()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.remux,
      quality: null,
      audio: 2,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    sessions.report({ mediaId: 1, client: ANNA, position: 5, audio: null, now: 1 })
    expect(sessions.list({ now: 2 })[0]?.audio).toBe(2)

    sessions.report({ mediaId: 1, client: ANNA, position: 6, audio: 1, now: 3 })
    // A range request of direct play names no track, so it keeps the one reported.
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 4,
    })
    expect(sessions.list({ now: 5 })[0]).toMatchObject({ audio: 1, mode: PLAYBACK_MODES.direct })
  })

  it('keeps the size a transcode asked for, and drops it for another mode', () => {
    const sessions = new StreamSessions()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.transcode,
      quality: 'high720',
      audio: 0,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    expect(sessions.list({ now: 1 })[0]?.quality).toBe('high720')
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.remux,
      quality: null,
      audio: 0,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 2,
    })
    expect(sessions.list({ now: 3 })[0]?.quality).toBeNull()
  })

  it('reads the send rate off the bytes sent within the window, closed responses included', () => {
    const sessions = new StreamSessions()
    const open = connection()
    const short = connection()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: open.open,
      from: 0,
      now: 0,
    })
    const release = sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: short.open,
      from: 0,
      now: 0,
    })

    open.state.sent = 1_000_000
    short.state.sent = 250_000
    release()
    // 1.25 MB in 2 s is 5 Mb/s.
    expect(sessions.list({ now: 2000 })[0]?.sendRate).toBe(5_000_000)

    // The look at the start falls out of the window, and from 2 s to 11 s nothing moved.
    expect(sessions.list({ now: 11_000 })[0]?.sendRate).toBe(0)
  })

  it('never takes back bytes a response sent when its count reads lower at close', () => {
    const sessions = new StreamSessions()
    const sending = connection()
    const release = sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: sending.open,
      from: 0,
      now: 0,
    })
    sending.state.sent = 500_000
    expect(sessions.list({ now: 1000 })[0]?.sendRate).toBe(4_000_000)
    sending.state.sent = 0
    release()
    expect(sessions.list({ now: 2000 })[0]?.sendRate).toBe(2_000_000)
  })

  it('has no send rate before a second look', () => {
    const sessions = new StreamSessions()
    sessions.open({
      purpose: STREAM_PURPOSES.play,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: connection().open,
      from: 0,
      now: 0,
    })
    expect(sessions.list({ now: 0 })[0]?.sendRate).toBeNull()
  })

  it('has nothing to stop for an id that is not live', () => {
    expect(new StreamSessions().stop('nothing')).toBe(false)
  })

  it('keeps a download apart from a play of the same video by the same client', () => {
    const sessions = new StreamSessions()
    const opened = (purpose: (typeof STREAM_PURPOSES)[keyof typeof STREAM_PURPOSES]) =>
      sessions.open({
        purpose,
        mediaId: 1,
        mode: PLAYBACK_MODES.direct,
        quality: null,
        audio: null,
        client: ANNA,
        connection: connection().open,
        from: 0,
        now: 0,
      })
    opened(STREAM_PURPOSES.play)
    opened(STREAM_PURPOSES.download)
    expect(sessions.list({ now: 0 }).map(({ purpose }) => purpose)).toEqual([
      STREAM_PURPOSES.play,
      STREAM_PURPOSES.download,
    ])
  })

  it('reaches as far into the file as a response starting at its range has sent', () => {
    const sessions = new StreamSessions()
    const resumed = connection()
    resumed.state.sent = 100
    const release = sessions.open({
      purpose: STREAM_PURPOSES.download,
      mediaId: 1,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      client: ANNA,
      connection: resumed.open,
      from: 5000,
      now: 0,
    })
    expect(sessions.list({ now: 0 })[0]?.reached).toBe(5000)
    resumed.state.sent = 1100
    expect(sessions.list({ now: 1000 })[0]?.reached).toBe(6000)
    resumed.state.sent = 1600
    release()
    expect(sessions.list({ now: 2000 })[0]?.reached).toBe(6500)
  })
})
