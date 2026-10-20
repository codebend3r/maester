import { afterEach, describe, expect, it } from 'bun:test'
import { PLAYBACK_MODES, isPlaybackDiagnostics } from '@raven/core'
import {
  NO_CONTEXT,
  codecSupport,
  gatherDiagnostics,
  readDevice,
} from '@/components/Player/errorReport'
import { mediaItem } from '@/test/fixtures'

/** Puts a field on `navigator` the way a browser that has it does, until the test ends. */
const given: string[] = []
const giveNavigator = ({ name, value }: { name: string; value: unknown }) => {
  Object.defineProperty(navigator, name, { value, configurable: true })
  given.push(name)
}

afterEach(() => {
  given.splice(0).forEach((name) => Reflect.deleteProperty(navigator, name))
})

describe('the browser’s answers', () => {
  it('asks about the container, the video and the audio, and both converted streams', () => {
    const support = codecSupport({
      media: mediaItem({ container: 'mp4', videoCodec: 'h264', videoBitDepth: 8 }),
      canPlay: (type) => !type.includes('mp4a'),
      canStream: (type) => type.includes('avc1'),
    })
    expect(support.play).toEqual([
      { type: 'video/mp4', isSupported: true },
      { type: 'video/mp4; codecs="avc1.640028"', isSupported: true },
      { type: 'video/mp4; codecs="mp4a.40.2"', isSupported: false },
    ])
    expect(support.stream).toEqual([
      { type: 'video/mp4; codecs="avc1.640028,mp4a.40.2"', isSupported: true },
      { type: 'video/mp4; codecs="avc1.640028,mp4a.40.2"', isSupported: true },
    ])
  })

  it('has nothing to ask without a file', () => {
    const support = codecSupport({ media: null, canPlay: () => true, canStream: () => true })
    expect(support.play).toEqual([])
    expect(support.stream).toEqual([])
  })
})

describe('the device', () => {
  it('reads what every browser says, and null for what this one keeps to itself', () => {
    const device = readDevice()
    expect(device.userAgent).toBe(navigator.userAgent)
    expect(device.languages).toEqual([...navigator.languages])
    expect(device.isOnline).toBe(navigator.onLine)
    expect(device.brands).toBeNull()
    expect(device.memory).toBeNull()
    expect(device.connection).toBeNull()
  })

  it('reads Chromium’s client hints, memory and connection where they are', () => {
    giveNavigator({
      name: 'userAgentData',
      value: {
        brands: [{ brand: 'Chromium', version: '141' }],
        mobile: true,
        platform: 'Android',
      },
    })
    giveNavigator({ name: 'deviceMemory', value: 4 })
    giveNavigator({
      name: 'connection',
      value: { effectiveType: '4g', downlink: 9.5, rtt: 50, saveData: false },
    })
    expect(readDevice()).toMatchObject({
      brands: ['Chromium 141'],
      isMobile: true,
      platform: 'Android',
      memory: 4,
      connection: { type: null, effectiveType: '4g', downlink: 9.5, rtt: 50, saveData: false },
    })
  })

  it('ignores client hints shaped other than the standard says', () => {
    giveNavigator({ name: 'userAgentData', value: { brands: 'Chromium' } })
    giveNavigator({ name: 'deviceMemory', value: 'lots' })
    expect(readDevice()).toMatchObject({ brands: null, isMobile: null, memory: null })
  })
})

describe('gathering a report', () => {
  it('makes diagnostics the server takes, even with nothing known of the file', () => {
    const diagnostics = gatherDiagnostics({
      title: 'Local clip',
      problems: ['Bad frame at https://lan.example.com/file?t=secret'],
      resumeAt: 0,
      context: NO_CONTEXT,
      pick: null,
      isProbingOrigins: true,
      appVersion: null,
      now: new Date(Date.UTC(2026, 9, 20, 12)),
    })
    expect(isPlaybackDiagnostics(diagnostics)).toBe(true)
    expect(diagnostics).toMatchObject({
      problems: ['Bad frame at https://lan.example.com/file?t=redacted'],
      media: null,
      playback: null,
      origin: null,
      isProbingOrigins: true,
      reportedAt: '2026-10-20T12:00:00.000Z',
    })
  })

  it('blanks a ticket in a failed way’s message, and takes the last failure’s spot', () => {
    const diagnostics = gatherDiagnostics({
      title: 'Busboys',
      problems: [],
      resumeAt: 10,
      context: {
        ...NO_CONTEXT,
        media: mediaItem(),
        ladder: {
          modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
          attempts: [
            {
              mode: PLAYBACK_MODES.remux,
              message: 'a?t=1',
              position: 3,
              frame: null,
              frames: null,
            },
            {
              mode: PLAYBACK_MODES.transcode,
              message: 'b',
              position: 8,
              frame: null,
              frames: null,
            },
          ],
          isForced: false,
          steppedDown: null,
          settings: null,
        },
      },
      pick: null,
      isProbingOrigins: false,
      appVersion: '1.0.0',
    })
    expect(diagnostics.playback?.attempts.map(({ message }) => message) ?? []).toEqual([
      'a?t=redacted',
      'b',
    ])
    expect(diagnostics.position).toEqual({ resumeAt: 10, failedAt: 8 })
  })
})
