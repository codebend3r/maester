import { describe, expect, it } from 'vitest'
import { checkDirectPlay, videoCodecString } from './playback.js'
import { chromeLike, mediaItem, safariLike } from './test/fixtures.js'

describe('checkDirectPlay', () => {
  it('plays an H.264/AAC MP4', () => {
    expect(checkDirectPlay({ media: mediaItem(), canPlay: chromeLike })).toEqual({
      playable: true,
      problems: [],
    })
  })

  it('plays a 10-bit HEVC MKV where the browser handles Matroska', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', videoBitDepth: 10 })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).playable).toBe(true)
  })

  it('names the container when the browser cannot open it', () => {
    const media = mediaItem({ container: 'mkv' })
    expect(checkDirectPlay({ media, canPlay: safariLike })).toEqual({
      playable: false,
      problems: ["The MKV container isn't supported here."],
    })
  })

  it('names the audio when only the audio is the problem', () => {
    const media = mediaItem({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' })
    expect(checkDirectPlay({ media, canPlay: chromeLike })).toEqual({
      playable: false,
      problems: ["Dolby Digital Plus audio isn't supported here."],
    })
  })

  it('lists video and audio problems together', () => {
    const media = mediaItem({ videoCodec: 'vc1', audioCodec: 'dts' })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).problems).toEqual([
      "VC-1 video isn't supported here.",
      "DTS audio isn't supported here.",
    ])
  })

  it('mentions the bit depth when that is what fails', () => {
    const media = mediaItem({ videoBitDepth: 10 })
    const eightBitOnly = (mime: string): boolean => !mime.includes('avc1.6E')
    expect(checkDirectPlay({ media, canPlay: eightBitOnly }).problems).toEqual([
      "10-bit H.264 video isn't supported here.",
    ])
  })

  it('plays a file with no audio track', () => {
    const media = mediaItem({ audioCodec: null, audioChannels: null })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).playable).toBe(true)
  })

  it('gives an unprobed file the benefit of the doubt when the container is fine', () => {
    const media = mediaItem({ videoCodec: null, audioCodec: null, duration: null })
    expect(checkDirectPlay({ media, canPlay: chromeLike }).playable).toBe(true)
  })

  it('rejects containers no browser plays', () => {
    expect(
      checkDirectPlay({ media: mediaItem({ container: 'avi' }), canPlay: chromeLike }).playable,
    ).toBe(false)
  })

  it('asks the client with the exact codec string', () => {
    const asked: string[] = []
    checkDirectPlay({
      media: mediaItem({
        container: 'mkv',
        videoCodec: 'hevc',
        videoBitDepth: 10,
        audioCodec: 'opus',
      }),
      canPlay: (mime) => {
        asked.push(mime)
        return true
      },
    })
    expect(asked).toEqual([
      'video/x-matroska',
      'video/x-matroska; codecs="hvc1.2.4.L153.B0"',
      'video/x-matroska; codecs="opus"',
    ])
  })
})

describe('videoCodecString', () => {
  it('picks the 10-bit profile for deep files', () => {
    expect(videoCodecString({ codec: 'h264', bitDepth: 8 })).toBe('avc1.640028')
    expect(videoCodecString({ codec: 'h264', bitDepth: 10 })).toBe('avc1.6E0028')
    expect(videoCodecString({ codec: 'mpeg2video', bitDepth: 8 })).toBeNull()
  })
})
