import { describe, expect, it } from 'bun:test'
import { withoutTickets } from '@/bugReports'
import { MEDIA_ORIGIN_KINDS, PLAYBACK_MODES } from '@/contract'
import { playbackDiagnostics } from '@/test/fixtures'

describe('keeping tickets out of a report', () => {
  it('drops the query and fragment of the page and the origin', () => {
    const scrubbed = withoutTickets(
      playbackDiagnostics({
        app: { version: null, page: 'https://raven.example.com/watch/7?t=account.abc#top' },
        origin: {
          kind: MEDIA_ORIGIN_KINDS.lan,
          url: 'https://raven.home.example.com?t=abc',
          pickedAt: 'now',
        },
      }),
    )
    expect(scrubbed.app.page).toBe('https://raven.example.com/watch/7')
    expect(scrubbed.origin?.url ?? null).toBe('https://raven.home.example.com')
  })

  it('blanks a ticket a problem or a failed way quotes, and leaves the rest', () => {
    const scrubbed = withoutTickets(
      playbackDiagnostics({
        problems: [
          'GET https://lan.example.com/api/media/7/file?t=account.abc&x=1 failed',
          'The connection to the server dropped.',
        ],
        playback: {
          modes: [PLAYBACK_MODES.remux],
          attempts: [
            {
              mode: PLAYBACK_MODES.remux,
              message: 'a?t=1',
              position: null,
              frame: null,
              frames: null,
            },
          ],
          isForced: false,
          steppedDown: null,
          settings: null,
        },
      }),
    )
    expect(scrubbed.problems).toEqual([
      'GET https://lan.example.com/api/media/7/file?t=redacted&x=1 failed',
      'The connection to the server dropped.',
    ])
    expect(scrubbed.playback?.attempts.map(({ message }) => message) ?? null).toEqual([
      'a?t=redacted',
    ])
  })

  it('leaves diagnostics with nothing to scrub as they were', () => {
    const plain = playbackDiagnostics({ playback: null, origin: null })
    expect(withoutTickets(plain)).toEqual(plain)
  })
})
