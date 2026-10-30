import { describe, expect, it } from 'bun:test'
import { AUDIO_PLATFORMS, canPlayAudio } from '@/canPlayAudio'
import { AUDIO_CODECS, CONTAINERS } from '@/playback'

describe('canPlayAudio', () => {
  it('refuses ALAC on Android, where it loads silent', () => {
    expect(
      canPlayAudio({
        platform: AUDIO_PLATFORMS.android,
        codec: AUDIO_CODECS.alac,
        container: 'm4a',
      }),
    ).toBe(false)
  })

  it('plays ALAC on Apple and in the browser', () => {
    expect(
      canPlayAudio({ platform: AUDIO_PLATFORMS.apple, codec: AUDIO_CODECS.alac, container: 'm4a' }),
    ).toBe(true)
    expect(
      canPlayAudio({
        platform: AUDIO_PLATFORMS.browser,
        codec: AUDIO_CODECS.alac,
        container: 'm4a',
      }),
    ).toBe(true)
  })

  it('refuses Opus in WebM on Apple but plays it in Ogg', () => {
    expect(
      canPlayAudio({
        platform: AUDIO_PLATFORMS.apple,
        codec: AUDIO_CODECS.opus,
        container: CONTAINERS.webm,
      }),
    ).toBe(false)
    expect(
      canPlayAudio({ platform: AUDIO_PLATFORMS.apple, codec: AUDIO_CODECS.opus, container: 'ogg' }),
    ).toBe(true)
  })

  it('plays Opus in WebM on Android', () => {
    expect(
      canPlayAudio({
        platform: AUDIO_PLATFORMS.android,
        codec: AUDIO_CODECS.opus,
        container: CONTAINERS.webm,
      }),
    ).toBe(true)
  })

  it('plays FLAC, MP3 and AAC everywhere', () => {
    const cases = [
      { codec: AUDIO_CODECS.flac, container: 'flac' },
      { codec: AUDIO_CODECS.mp3, container: 'mp3' },
      { codec: AUDIO_CODECS.aac, container: 'm4a' },
    ]
    Object.values(AUDIO_PLATFORMS).forEach((platform) =>
      cases.forEach(({ codec, container }) =>
        expect(canPlayAudio({ platform, codec, container })).toBe(true),
      ),
    )
  })
})
