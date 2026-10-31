import { describe, expect, it } from 'bun:test'
import {
  SCROBBLE_RETURNS,
  SCROBBLE_SERVICES,
  isLastFmStart,
  isListenBrainzLink,
  isScrobbleStatus,
} from '@/contract/scrobbling'

describe('scrobbling', () => {
  it('reads a status with a name, or none while unlinked', () => {
    expect(
      isScrobbleStatus({ service: SCROBBLE_SERVICES.lastFm, isAvailable: true, username: 'rj' }),
    ).toBe(true)
    expect(
      isScrobbleStatus({
        service: SCROBBLE_SERVICES.listenBrainz,
        isAvailable: true,
        username: null,
      }),
    ).toBe(true)
    expect(isScrobbleStatus({ service: 'spotify', isAvailable: true, username: null })).toBe(false)
  })

  it('takes a ListenBrainz token with no spaces, and no more than 128 characters', () => {
    expect(isListenBrainzLink({ token: '6b2c3a90-1e4f-4c55-9b0e-2c4d1a7f8e31' })).toBe(true)
    expect(isListenBrainzLink({ token: '' })).toBe(false)
    expect(isListenBrainzLink({ token: 'two words' })).toBe(false)
    expect(isListenBrainzLink({ token: 'a'.repeat(129) })).toBe(false)
  })

  it('takes a return by name: the web, or Wren, and nothing else', () => {
    expect(isLastFmStart({ returnTo: SCROBBLE_RETURNS.web })).toBe(true)
    expect(isLastFmStart({ returnTo: SCROBBLE_RETURNS.wren })).toBe(true)
    expect(isLastFmStart({ returnTo: 'https://raven.example/settings' })).toBe(false)
    expect(isLastFmStart({ returnTo: '/settings' })).toBe(false)
    expect(isLastFmStart({})).toBe(false)
  })
})
