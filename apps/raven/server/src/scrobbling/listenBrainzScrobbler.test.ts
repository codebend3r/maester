import { describe, expect, it } from 'vitest'
import { RAVEN_USER_AGENT } from '@/music/userAgent'
import { ListenBrainzScrobbler } from '@/scrobbling/listenBrainzScrobbler'
import { SEND_OUTCOMES } from '@/scrobbling/scrobbler'
import { fakeListenBrainz } from '@/test/fakeListenBrainz'

const LISTEN = {
  listenedAt: 1_793_000_000,
  artist: 'Radiohead',
  track: 'Airbag',
  album: 'OK Computer',
  durationSeconds: 284.4,
  recordingMbid: '5b12d1c4-4b61-4dc8-8b54-4f0a4ad3e8c1',
  releaseMbid: null,
}

describe('ListenBrainzScrobbler', () => {
  it("names the token's user, and nobody for a token ListenBrainz does not know", async () => {
    const fake = fakeListenBrainz({ users: { good: 'rj' } })
    const scrobbler = new ListenBrainzScrobbler(fake.fetch, 1000)
    await expect(scrobbler.validate({ token: 'good' })).resolves.toEqual({
      username: 'rj',
      secret: 'good',
    })
    await expect(scrobbler.validate({ token: 'bad' })).resolves.toBeNull()
    expect(fake.requests.every(({ userAgent }) => userAgent === RAVEN_USER_AGENT)).toBe(true)
    fake.setDown({ isDown: true })
    await expect(scrobbler.validate({ token: 'good' })).rejects.toThrow()
  })

  it('submits a single listen with the ids the tags gave, and reads what each answer means', async () => {
    const fake = fakeListenBrainz({ users: { good: 'rj' } })
    const scrobbler = new ListenBrainzScrobbler(fake.fetch, 1000)
    await expect(scrobbler.send({ secret: 'good', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.sent,
    )
    expect(fake.submissions).toEqual([
      {
        token: 'good',
        body: {
          listen_type: 'single',
          payload: [
            {
              listened_at: LISTEN.listenedAt,
              track_metadata: {
                artist_name: 'Radiohead',
                track_name: 'Airbag',
                release_name: 'OK Computer',
                additional_info: { duration_ms: 284_400, recording_mbid: LISTEN.recordingMbid },
              },
            },
          ],
        },
      },
    ])
    await expect(scrobbler.send({ secret: 'stale', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.unlinked,
    )
    fake.setSubmitStatus({ status: 400 })
    await expect(scrobbler.send({ secret: 'good', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.rejected,
    )
    fake.setSubmitStatus({ status: 429 })
    await expect(scrobbler.send({ secret: 'good', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.retry,
    )
    fake.setDown({ isDown: true })
    await expect(scrobbler.send({ secret: 'good', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.retry,
    )
  })
})
